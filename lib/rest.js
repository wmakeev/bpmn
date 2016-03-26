/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var find = require('./find');
var log = require('./logger');
var restify = require('restify');
var uuid = require('node-uuid');
var querystring = require('querystring');
// var bunyan2winston = require("./utils/bunyan2winston");


var transactionLog = null;
var receivedMessageIds = {};
var reservedQueryNames = {
  state: 'state'
};

/**
 * @api {post} /bpmnCollaborate Create and start process
 * @apiName CreateAndStartCollaborating
 * @apiGroup BPMN
 *
 * @apiDescription Creates collaborating processes and then triggers immediately the start event
 * of main process.
 *
 * @req.body {array} of processName Name,id of the process as used in the BPMN model
 * {name: "processOneName", "processOneId"},
 * {name: "processTwoName", processTwoId},
 * {name: "processThreeName", processThreeId},
 * {name: "mainProcess", mainProcessId, startEventName:"starterEventName"}
 * gotta fix routes, first one traps all.

 */
var createAndStartCollaboratingProcessRoute = '/bpmnCollaborate';

/**
 * @api {post} /:processName Create process
 * @apiName CreateProcess
 * @apiGroup BPMN
 *
 * @apiDescription Creates a process but does not start it. To do this either send a message
 *                 or use CreateAndStartProcess.
 *
 * @apiDescription {String} processName Name of the process as used in the BPMN model
 */
var createProcessRoute = '/:processName';

/**
 * @api {post} /:processName/:startEventName Create and start process
 * @apiName CreateAndStartProcess
 * @apiGroup BPMN
 *
 * @apiDescription Creates a process and then triggers immediately the start event.
 *
 * @apiParam {String} processName Name of the process as used in the BPMN model
 * @apiParam {String} startEventName Event name as used in the BPMN model for starting this process
 */
var createAndStartProcessRoute = '/:processName/:startEventName';

/**
 * @api {get} /:processName/:id Get process instance
 * @apiName GetProcess
 * @apiGroup BPMN
 *
 * @apiDescription Returns the process state.
 *
 * @apiParam {String} processName Name of the process as used in the BPMN model
 * @apiParam {String} id Unique id of the process instance
 */
var getProcessRoute = '/:processName/:id';

/**
 * @api {get} /:processName/[?query]    Get process instances
 * @apiName GetProcesses
 * @apiGroup BPMN
 *
 * @apiDescription Get process instances.
 *                 The query strings accesses process properties.
 *
 * @apiParam {String} processName Name of the process as used in the BPMN model
 */
var getProcessesRoute = '/:processName';

/**
 * @api {put} /:processName/:id/:messageName/:messageId Send messages or trigger events.
 *
 * @apiName SendMessage
 * @apiGroup BPMN
 *
 * @apiDescription The messageId is used to make this call idempotent.
 *                 If the messageId is received the first time, a message is being created and
 *                 sent to the process and the status code 201 (Created) is returned.
 *                 For all subsequent request having the same URI the message is thrown away and
 *                 the status code 200 is returned.
 *
 * @apiParam {String} processName Name of the process as used in the BPMN model
 * @apiParam {String} id Unique id of the process instance
 * @apiParam {String} messageName Message or event name as used in the BPMN model for
 *                    messages respectively event elements
 * @apiParam {String} messageId This id is used to implement idempotency.
 *
 */
var sendMessageRoute = '/:processName/:id/:messageName/:messageId';

try {
  transactionLog = require('e2e-transaction-logger');
} catch (err) {
  transactionLog = null;
}

function getParameter(req, parameterName) {
  return (querystring.unescape(req.params[parameterName]));
}

/**
 * @param {BPMNProcess} bpmnProcess
 * @returns {{state: *}}
 */
function getProcessResponse(bpmnProcess) {
  var response = {};
  var processId;
  var processName;
  var escape;

  if (bpmnProcess) {
    processId = bpmnProcess.getProcessId();
    processName = bpmnProcess.getProcessDefinition().name;
    escape = querystring.escape;

    response = {
      id: processId,
      name: processName,
      link: {
        rel: 'self',
        href: '/' + escape(processName) + '/' + escape(processId)
      },
      state: bpmnProcess.getState().tokens,
      history: bpmnProcess.getHistory().historyEntries,
      properties: bpmnProcess.getProperties()
    };
  }

  return response;
}

function getPropertyQuery(query) {
  var propertyQuery = {};
  var queryNames = Object.keys(query);

  queryNames.forEach(function queryNamesIter(queryName) {
    if (!reservedQueryNames[queryName]) {
      propertyQuery[queryName] = query[queryName];
    }
  });

  return propertyQuery;
}

function hasBeenAlreadyReceived(idempotenceId) {
  var result = false;

  if (idempotenceId) {
    if (receivedMessageIds[idempotenceId]) {
      result = true;
    } else {
      receivedMessageIds[idempotenceId] = true;
    }
  }

  return result;
}

function triggerEvent(bpmnProcess, logger, eventName, data) {
  var message = data || {};
  logger.trace('Triggering event "' + eventName + '"' + JSON.stringify(message));
  bpmnProcess.triggerEvent(eventName, data);
}

function sendError(error, next) {
  var restError;

  if (error.bpmnParseErrors) {
    restError = new restify.RestError({
      restCode: 'BPMNParseError',
      body: error
    });
  } else {
    restError = new restify.RestError({
      restCode: 'BPMNExecutionError',
      message: error.toString()
    });
  }

  return next(restError);
}

function sendMessage(manager, logger, req, res, next) {
  var processId = getParameter(req, 'id');
  var processName = getParameter(req, 'processName');
  var messageId = getParameter(req, 'messageId');
  var messageName = getParameter(req, 'messageName');
  var idempotenceId;

  manager.get(processId, function managerGetHandler(err, bpmnProcess) {
    if (err) {
      return sendError(err, next);
    }

    idempotenceId = processName + '.' + processId + '.' + messageName + '.' + messageId;

    logger.setProcess(bpmnProcess);

    if (hasBeenAlreadyReceived(idempotenceId)) {
      return res.send(200, getProcessResponse(bpmnProcess));
    }

    try {
      triggerEvent(bpmnProcess, logger, messageName, req.body);
      // 201: Resource (=message) created
      res.send(201, getProcessResponse(bpmnProcess));
    } catch (e) {
      sendError(e, next);
    }

    return void 0;
  });
}

function getProcess(manager, req, res, next) {
  var processId = getParameter(req, 'id');

  manager.get(processId, function managerGetHandler(err, bpmnProcess) {
    if (err) {
      return sendError(err, next);
    }

    return res.send(getProcessResponse(bpmnProcess));
  });
}

// TODO: paging?
function getProcesses(manager, req, res, next) {
  var stateName;
  var processName;
  var response;

  processName = querystring.unescape(req.params.processName);

  manager.findByName(processName, false, function findByNameHandler(err, bpmnProcesses) {
    var _bpmnProcesses = bpmnProcesses;
    if (err) {
      return sendError(err, next);
    }

    if (req.query) {
      _bpmnProcesses = find.findByProperty(_bpmnProcesses, getPropertyQuery(req.query));

      stateName = req.query[reservedQueryNames.state];
      if (stateName) {
        _bpmnProcesses = find.findByState(_bpmnProcesses, stateName);
      }
    }

    response = _bpmnProcesses.map(function bpmnProcessesIter(bpmnProcess) {
      return getProcessResponse(bpmnProcess);
    });

    return res.send(response);
  });
}

/**
 * getNameWithCase
 *
 * @param {ProcessManager} manager
 * @param {String} name
 * @param {Function} callback
 * @returns {*}
 */
function getNameWithCase(manager, name, callback) {
  return manager.getDefinitionNames(function getDefinitionNamesHandler(err, names) {
    var ret = null;

    if (err) {
      return callback(err);
    }

    names.forEach(function namesIter(nameWithCase) {
      if (name.toLowerCase() === nameWithCase.toLowerCase()) {
        ret = nameWithCase;
      }
    });

    return callback(null, ret);
  });
}

function createAndStartProcess(manager, options, logger, req, res, next, startProcess) {
  var processId;
  var processNameWithoutCase;
  var startEventName;

  processId = options.createProcessId();
  processNameWithoutCase = querystring.unescape(req.params.processName);

  getNameWithCase(manager, processNameWithoutCase,
    function getNameWithCaseHandler(getNameError, processName) {
      if (getNameError) {
        return sendError(getNameError, next);
      }

      if (!processName) {
        return next(new restify.InvalidArgumentError('Could not find process name "'
          + processNameWithoutCase + '".'));
      }

      return manager.createProcess({ id: processId, name: processName },
        function createProcessHandler(createProcessError, bpmnProcess) {
          if (createProcessError) {
            return sendError(createProcessError, next);
          }

          logger.setProcess(bpmnProcess);

          if (startProcess === undefined || startProcess) {
            startEventName = querystring.unescape(req.params.startEventName);

            try {
              triggerEvent(bpmnProcess, logger, startEventName, req.body, true);
            } catch (e) {
              return sendError(e, next);
            }
          }

          return res.send(201, getProcessResponse(bpmnProcess));
        });
    });
}

function createProcess(manager, settings, logger, req, res, next) {
  createAndStartProcess(manager, settings, logger, req, res, next, false);
}

function createAndStartCollaboratingProcess(manager, options, logger, req, res, next) {
  // var processId;
  var startEventName;
  var processDescriptors;
  var mainProcessDescriptor;
  var bpmnMainProcess;
  var numDescriptors;

  // processId = options.createProcessId();
  processDescriptors = req.body.processDescriptors;
  numDescriptors = processDescriptors.length;
  processDescriptors.forEach(function processDescriptorsIter(processDescriptor, i) {
    var processNameWithoutCase = processDescriptor.name;
    getNameWithCase(manager, processNameWithoutCase, function getNameWithCaseHandler(err,
                                                                                     processName) {
      if (err) {
        return sendError(err, next);
      }

      if (!processName) {
        next(new restify.InvalidArgumentError('Could not find process name "'
          + processNameWithoutCase + '".'));
      }
      return void 0;
    });

    if (processDescriptor.startEventName) {
      mainProcessDescriptor = processDescriptor;
    }

    // last loop
    if (i === numDescriptors - 1) {
      manager.createProcess(processDescriptors, function createProcessHandler(err, bpmnProcesses) {
        if (err) {
          return sendError(err, next);
        }

        bpmnProcesses.forEach(function bpmnProcessesIter(bpmnProcess) {
          logger.setProcess(bpmnProcess);
          if (mainProcessDescriptor.id === bpmnProcess.getProcessId()) {
            startEventName = mainProcessDescriptor.startEventName;

            try {
              triggerEvent(bpmnProcess, logger, startEventName, req.body, true);
              bpmnMainProcess = bpmnProcess;
            } catch (e) {
              return sendError(e, next);
            }
          }
          return void 0;
        });

        return res.send(201, getProcessResponse(bpmnMainProcess));
      });
    }
  });
}

function onServerAfterEvent(logger, request, response, route, error) {
  var requestInfo = {
    method: request.method,
    headers: request.headers,
    body: request.body
  };
  var responseInfo = {
    method: response.method,
    headers: response.headers,
    body: response.body
  };

  logger.debug('route: ' + JSON.stringify(route));
  logger.debug('request: ' + JSON.stringify(requestInfo));
  logger.debug('response: ' + JSON.stringify(responseInfo));

  if (error) {
    logger.debug('error: ' + JSON.stringify(error));
  }
}

exports.clearReceivedMessageIds = function clearReceivedMessageIds() {
  receivedMessageIds = {};
};

/**
 * Creates a REST server based on the restify framework. It takes two parameters, options
 * and restifyOptions.
 *      options: optional object having the following optional properties
 *          createProcessId: Function that returns a UUID. Default: node-uuid.v1()
 *          logLevel: used log level. Default: Error. Use logger.logLevels to set.
 *      restifyOptions: these options are given to the restify.createServer call.
 *                      If not given, the log property is set to the internal winston logger and
 *                      the name property is set to 'bpmnRESTServer'
 * @param {ProcessManager} manager
 * @param {{createProcessId: function, logLevel: logger.logLevels}=} options
 * @param {Object=} restifyOptions
 * @returns {*}
 */
exports.createServer = function createServer(manager, options, restifyOptions) {
  var logger;
  var serverOptions;
  var server;
  var settings = options || {};

  settings.createProcessId = settings.createProcessId || uuid.v1;

  logger = new log.Logger(null, settings);
  serverOptions = restifyOptions || {};
  serverOptions.name = serverOptions.name || 'BPMNProcessServer';

  // Shimming the log doesn't work as expected: I cannot switch it off for example.
  // Additionally, the log format is horrible. So for the time being we use our own logging
  // serverOptions.log = serverOptions.log || bunyan2winston.createLogger(logger.winstonLogger);

  server = restify.createServer(serverOptions);

  server.use(restify.queryParser({ mapParams: false }));
  server.use(restify.bodyParser({ mapParams: false }));
  server.on('after', function onAfterHandler(request, response, route, error) {
    var handler = options.onServerAfterEvent || onServerAfterEvent;
    handler(logger, request, response, route, error);
  });

  server.get(getProcessRoute,
    transactionLog.transactionLoggerMiddleware({
      name: function name(req) {
        return 'GET ' + req.params.processName + ' process';
      }
    }),
    function getProcessMiddleware(req, res, next) {
      getProcess(manager, req, res, next);
    });

  server.get(getProcessesRoute,
    transactionLog.transactionLoggerMiddleware({
      name: function name(req) {
        return 'GET ' + req.params.processName + ' processes';
      }
    }),
    function getProcessesMiddleware(req, res, next) {
      getProcesses(manager, req, res, next);
    });

  server.put(sendMessageRoute,
    transactionLog.transactionLoggerMiddleware({
      name: function name(req) {
        return 'PUT ' + req.params.messageName + ' message to ' + req.params.processName
          + ' process';
      }
    }),
    function sendMessageMiddleware(req, res, next) {
      sendMessage(manager, logger, req, res, next);
    }
  );

  // TODO: we need to change these routes. the catch all '/' makes this load order dependent.
  server.post(createAndStartCollaboratingProcessRoute,
    transactionLog.transactionLoggerMiddleware({
      name: function name() {
        return 'POST create and start collaborating processes';
      }
    }),
    function createAndStartCollaboratingProcessMiddleware(req, res, next) {
      createAndStartCollaboratingProcess(manager, settings, logger, req, res, next);
    }
  );

  server.post(createProcessRoute,
    transactionLog.transactionLoggerMiddleware({
      name: function name(req) {
        return 'POST create ' + req.params.processName + ' process';
      }
    }),
    function createProcessMiddleware(req, res, next) {
      createProcess(manager, settings, logger, req, res, next);
    }
  );
  server.post(createAndStartProcessRoute,
    transactionLog.transactionLoggerMiddleware({
      name: function name(req) {
        return 'POST create and start ' + req.params.processName + ' process';
      }
    }),
    function createAndStartProcessMiddleware(req, res, next) {
      createAndStartProcess(manager, settings, logger, req, res, next);
    }
  );

  return server;
};
