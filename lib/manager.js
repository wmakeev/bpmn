/**
 * Copyright: E2E Technologies Ltd
 * Author: Cyril Schmitt <cschmitt@e2ebridge.com>
 */

'use strict';

var async = require('async');
var util = require('util');

var definitions = require('./parsing/definitions');
var handlers = require('./handler');
var Persistency = require('./persistency/persistency').Persistency;
var createBPMNProcess = require('./process').createBPMNProcess;
var find = require('./find');
var rest = require('./rest');

/**
 * @param {{
 *      bpmnFilePath: String|Array.<String>=,
 *      handlerFilePath: {name: String, filePath: String}|Array.<{name: String, filePath: String}>=,
 *      handler: {name: String, module: Object}|Array.<{name: String, module: Object}>=,
 *      persistencyOptions: {uri: String, doneLoading: Function, doneSaving: Function}=
 *  }} options
 * @constructor
 */
function ProcessManager(options) {
  var self = this;
  var opt = options || {};

  self._processCache = {};

  self._initialized = true;
  self._initialising = false;
  self._initializationError = null;
  self._definitionsToInitialize = [];
  self._initialiseCallbacks = [];

  self._persistency = null;
  if (opt.persistencyOptions) {
    self._persistency = new Persistency(opt.persistencyOptions);
    self._doneLoadingHandler = opt.persistencyOptions.doneLoading;
    self._doneSavingHandler = opt.persistencyOptions.doneSaving;
  }

  self._processHandlers = {};
  self._processDefinitions = {};


  if (!opt.handlerFilePath) {
    opt.handlerFilePath = [];
  }

  if (!util.isArray(opt.handlerFilePath)) {
    opt.handlerFilePath = [opt.handlerFilePath];
  }

  opt.handlerFilePath.forEach(function iter(handlerDescriptor) {
    if (!handlerDescriptor.name || !handlerDescriptor.filePath) {
      throw new Error('handlerFilePath needs a name and a filePath');
    }

    self.addHandlerFilePath(handlerDescriptor.name, handlerDescriptor.filePath);
  });


  if (!opt.handler) {
    opt.handler = [];
  }

  if (!util.isArray(opt.handler)) {
    opt.handler = [opt.handler];
  }

  opt.handler.forEach(function iter(handlerDescriptor) {
    if (!handlerDescriptor.name || !handlerDescriptor.module) {
      throw new Error('handler needs a name and a module');
    }

    self.addHandler(handlerDescriptor.name, handlerDescriptor.module);
  });

  if (!opt.handlerString) {
    opt.handlerString = [];
  }

  if (!util.isArray(opt.handlerString)) {
    opt.handlerString = [opt.handlerString];
  }

  opt.handlerString.forEach(function iter(handlerString) {
    if (!handlerString.name || !handlerString.string) {
      throw new Error('handlerString needs a name and a string');
    }

    self.addHandlerString(handlerString.name, handlerString.string);
  });

  if (!opt.bpmnFilePath) {
    opt.bpmnFilePath = [];
  }

  if (!util.isArray(opt.bpmnFilePath)) {
    opt.bpmnFilePath = [opt.bpmnFilePath];
  }

  opt.bpmnFilePath.forEach(function iter(filePath) {
    self.addBpmnFilePath(filePath, null);
  });

  if (!opt.bpmnXML) {
    opt.bpmnXML = [];
  }

  if (!util.isArray(opt.bpmnXML)) {
    opt.bpmnXML = [opt.bpmnXML];
  }

  opt.bpmnXML.forEach(function iter(bpmnXML) {
    if (!bpmnXML.name || !bpmnXML.xml) {
      throw new Error('bpmnXML needs a name and a xml');
    }

    self.addBpmnXML(bpmnXML.xml, bpmnXML.name);
  });
}
exports.ProcessManager = ProcessManager;

/**
 * Initialise a new definition by loading all persisted process.
 * All other function that need the initialise state will wait until initialization is done.
 *
 * @param {BPMNProcessDefinition} processDefinition
 * @private
 */
ProcessManager.prototype._initialiseDefinition = function _initialiseDefinition(processDefinition) {
  var self = this;

  self._initializationError = null;
  self._initialized = false;

  self._definitionsToInitialize.push(processDefinition);

  /**
   * Called after all initializations are done.
   * @param err
   */
  function execCallbacks(err) {
    self._definitionsToInitialize = [];

    self._initializationError = err;
    self._initialized = true;
    self._initialising = false;

    self._initialiseCallbacks.forEach(function iter(callback) {   // call all waiting callbacks
      callback(err);
    });
  }

  function next() {
    var currentDefinition;

    self._initialising = true;

    // if all definitions have been initialized
    if (self._definitionsToInitialize.length === 0) {
      return execCallbacks();
    }

    // get the next definition
    currentDefinition = self._definitionsToInitialize.pop();

    // if the definition already exist it means the processes were already loaded
    // if there is no persistency nothing needs to be loaded
    if (self._processDefinitions[currentDefinition.name] || !self._persistency) {
      // we simply add or replace the definition
      self._processDefinitions[currentDefinition.name] = currentDefinition;
      return next();
    }

    // load all saved document
    self._persistency.loadAll(currentDefinition.name, function loadHandler(err, documents) {
      if (err) {
        execCallbacks(err);
        return;
      }

      self._processDefinitions[currentDefinition.name] = currentDefinition;

      // for each persisted document found
      async.each(documents, function iter(document, done) {
        self._createSingleProcess(
          // create the process
          document.processId, currentDefinition.name,
          function createProcessHandler(createProcessErr, bpmnProcess) {
            if (createProcessErr) {
              return done(createProcessErr);
            }

            // check if id already used
            if (self._processCache[bpmnProcess.getProcessId()]) {
              return done(new Error('duplicated id in persisted data'));
            }

            self._processCache[bpmnProcess.getProcessId()] = bpmnProcess;
            return done();
          });
      }, function eachErrHandler(iterError) {
        if (iterError) {
          return execCallbacks(iterError);
        }

        return next();
      });
    });

    return null;
  }

  // if already initialising we don't call next, the definition will be initialised
  // after current one.
  if (!self._initialising) {
    next();
  }
};

/**
 * The callback will be called after initialized
 *
 * @param callback
 * @private
 */
ProcessManager.prototype._afterInitialization = function _afterInitialization(callback) {
  if (this._initialized) {
    return callback(this._initializationError);
  }

  this._initialiseCallbacks.push(callback);
};

/**
 * Change the process handler using a file.
 *
 * @param {String} name Name of the process
 * @param {String} handlerFilePath
 */
ProcessManager.prototype.addHandlerFilePath = function addHandlerFilePath(name, handlerFilePath) {
  this._processHandlers[name] = handlers.getHandlerFromFile(handlerFilePath);
  this._processHandlers[name].doneLoadingHandler = this._doneLoadingHandler ||
    this._processHandlers[name].doneLoadingHandler;
  this._processHandlers[name].doneSavingHandler = this._doneSavingHandler ||
    this._processHandlers[name].doneSavingHandler;
};

/**
 * Change the process handler using a string.
 *
 * @param {String} name Name of the process
 * @param {String} handlerString
 */
ProcessManager.prototype.addHandlerString = function addHandlerString(name, handlerString) {
  this._processHandlers[name] = handlers.getHandlerFromString(handlerString);
  this._processHandlers[name].doneLoadingHandler = this._doneLoadingHandler ||
    this._processHandlers[name].doneLoadingHandler;
  this._processHandlers[name].doneSavingHandler = this._doneSavingHandler ||
    this._processHandlers[name].doneSavingHandler;
};

/**
 * Change the process handler using an object.
 *
 * @param {String} name Name of the process.
 * @param {String} handler
 */
ProcessManager.prototype.addHandler = function addHandler(name, handler) {
  this._processHandlers[name] = handler;
  this._processHandlers[name].doneLoadingHandler = this._doneLoadingHandler ||
    this._processHandlers[name].doneLoadingHandler;
  this._processHandlers[name].doneSavingHandler = this._doneSavingHandler ||
    this._processHandlers[name].doneSavingHandler;
};

/**
 * Add a bpmn file to the manager.
 * All process definition found in this file will be initialized and replace the old ones if exists.
 * A process handler object or file path can be passed. If none passed the same file path as the
 * bpmn is used or the existing handler.
 * An error is thrown if no handler is found.
 *
 * @param {String} bpmnFilePath
 * @param {Object|String} processHandler
 */
ProcessManager.prototype.addBpmnFilePath = function addBpmnFilePath(bpmnFilePath, processHandler) {
  var self = this;
  var processDefinitions;
  var handler = processHandler;

  if (typeof handler === 'string') {
    handler = handlers.getHandlerFromFile(processHandler);
  }

  if (!handler) {
    try {
      handler = handlers.getHandlerFromFile(bpmnFilePath);
      handler.doneLoadingHandler = self._doneLoadingHandler;
      handler.doneSavingHandler = self._doneSavingHandler;
    } catch (err) {
      // no handler
    }
  }

  processDefinitions = definitions.getBPMNProcessDefinitions(bpmnFilePath);

  processDefinitions.forEach(function iter(processDefinition) {
    if (processHandler) {
      self._processHandlers[processDefinition.name] = processHandler;
    } else if (!self._processHandlers[processDefinition.name]) {
      throw new Error('No process handler defined for process "' + processDefinition.name +
        '". The process handler must be defined before the process or with the process.');
    }

    self._initialiseDefinition(processDefinition);
  });
};

/**
 * Add a bpmn XML to the manager.
 * All process definition found in this file will be initialized and replace the old ones if exists.
 * A process handler object or file path can be passed. If none passed the same file path as the
 * bpmn is used or the existing handler.
 * An error is thrown if no handler is found.
 *
 * @param {String} bpmnXml
 * @param {String=} processName
 * @param {Object|String=} processHandler
 */
ProcessManager.prototype.addBpmnXML = function addBpmnXML(bpmnXml, processName, processHandler) {
  var self = this;
  var processDefinitions;
  var handler = typeof processHandler === 'string'
    ? handlers.getHandlerFromString(processHandler) : processHandler;

  processDefinitions = definitions.getBPMNDefinitionsFromXML(bpmnXml, processName);

  processDefinitions.forEach(function iter(processDefinition) {
    if (handler) {
      self._processHandlers[processDefinition.name] = handler;
    } else if (!self._processHandlers[processDefinition.name]) {
      throw new Error('No process handler defined for process "' + processDefinition.name +
        '". The process handler must be defined before the process or with the process.');
    }

    self._initialiseDefinition(processDefinition);
  });
};


/**
 * @param {String} processId
 * @param {Function} callback
 */
ProcessManager.prototype.get = function get(processId, callback) {
  var self = this;

  this._afterInitialization(function handler(err) {
    if (callback) {
      callback(err, self._processCache[processId]);
    }
  });
};

/**
 * @param {String} processId
 * @param {String} processName
 * @param {Function} callback
 */
ProcessManager.prototype._createSingleProcess =
  function _createSingleProcess(processId, processName, callback) {
    createBPMNProcess(processId, this._processDefinitions[processName],
      this._processHandlers[processName], this._persistency,
      function handler(err, bpmnProcess) {
        callback(err, bpmnProcess);
      });
  };

/**
 * @param {Array.<{name: String, id: String}>} processDescriptors
 * @param {Function} callback
 * @return {Array.<BPMNProcessClient>}
 */
ProcessManager.prototype._createCollaboratingProcesses =
  function _createCollaboratingProcesses(processDescriptors, callback) {
    var self = this;
    var processes = {};

    async.eachSeries(processDescriptors, function iter(processDescriptor, done) {
      self._createSingleProcess(processDescriptor.id,
        processDescriptor.name, function createHandler(err, bpmnProcess) {
          if (err) {
            done(err);
          }
          processes[processDescriptor.name] = bpmnProcess;
          done();
        });
    }, function eachErrHandler(err) {
      var results = [];

      Object.keys(processes).forEach(function keysIter(name) {
        var bpmnProcess = processes[name];

        var participants = bpmnProcess.getProcessDefinition().getCollaboratingParticipants();

        participants.forEach(function participantsIter(participant) {
          bpmnProcess.addParticipant(participant.name, processes[participant.name]);
        });

        results.push(bpmnProcess);
      });

      callback(err, results);
    });
  };

/**
 * A BPMN process is created using the descriptor name and id, it's state is loaded
 * if it has been persisted.
 * A simple id can be passed if there is only one process definition.
 * If there are multiple definitions, an array of descriptors can be passed and an array
 * of collaborating BPMN processes is created.
 * The processId parameter needs to correspond.
 *
 * @param {String|{name: String, id: String}|Array.<{name: String, id: String}>} descriptors
 * @param {Function} callback
 */
ProcessManager.prototype.createProcess = function createProcess(descriptors, callback) {
  var self = this;
  var error;
  var errors;
  var descriptorRef;

  this._afterInitialization(function afterInitializationHandler(afterInitializationError) {
    error = afterInitializationError;

    if (error) {
      return callback(error);
    }

    if (typeof descriptors === 'string' && Object.keys(self._processDefinitions).length !== 1) {
      return callback(new Error('The manager contains more than one process definition. ' +
        'processId have to be an Array.<{name: String, id: String}>} '));
    }

    if (util.isArray(descriptors)) {
      // check if one of the ids is already used
      errors = descriptors.reduce(function reducer(res, descriptor) {
        if (self._processCache[descriptor.id]) {
          res.push(new Error('id already used'));
        }
        return res;
      }, []);
      if (errors.length) {
        return callback(errors[errors.length - 1]);
      }

      self._createCollaboratingProcesses(descriptors,
        function createCollaboratingProcessesHandler(createProcessError, bpmnProcesses) {
          error = createProcessError;

          if (error) {
            return callback(error);
          }

          // check if one of the ids is already used again because
          // a process could have been created in between
          errors = descriptors.reduce(function reducer(res, descriptor) {
            if (self._processCache[descriptor.id]) {
              res.push(new Error('id already used'));
            }
            return res;
          }, []);
          if (errors.length) {
            return callback(errors[errors.length - 1]);
          }

          return callback(null, bpmnProcesses.map(function iter(bpmnProcess) {
            self._processCache[bpmnProcess.getProcessId()] = bpmnProcess;
            return bpmnProcess.processClient;
          }));
        });

      return void 0;
    }

    if (typeof descriptors === 'string') {
      descriptorRef = {
        id: descriptors,
        name: Object.keys(self._processDefinitions)[0]
      };
    }

    // check if id already used
    if (self._processCache[descriptorRef.id]) {
      return callback(new Error('id already used'));
    }

    self._createSingleProcess(descriptorRef.id, descriptorRef.name,
      function createSingleProcessHandler(err, bpmnProcess) {
        if (err) {
          return callback(err);
        }

        // check if id already used again because a process could have been created in between
        if (self._processCache[descriptors.id]) {
          return callback(new Error('id already used'));
        }

        self._processCache[descriptors.id] = bpmnProcess;
        return callback(null, bpmnProcess.processClient);
      });

    return null;
  });
};

/**
 * @param {Function} callback
 */
ProcessManager.prototype._getAllProcesses = function _getAllProcesses(callback) {
  var self = this;
  var allProcessIds = Object.keys(this._processCache);

  if (!callback) {
    return;
  }

  callback(null, allProcessIds.map(function iter(loadedProcessId) {
    return self._processCache[loadedProcessId];
  }));
};

/**
 * @param {Function} callback
 */
ProcessManager.prototype.getAllProcesses = function getAllProcesses(callback) {
  var self = this;

  if (!callback) {
    return;
  }


  this._afterInitialization(function afterInitializationHandler(afterInitializationError) {
    if (afterInitializationError) {
      return callback(afterInitializationError);
    }

    self._getAllProcesses(function getAllProcessesHandler(getAllProcessesError, bpmnProcesses) {
      if (getAllProcessesError) {
        return callback(getAllProcessesError);
      }

      return callback(null, bpmnProcesses.map(function iter(bpmnProcess) {
        return bpmnProcess.processClient;
      }));
    });

    return void 0;
  });
};

/**
 * Returns all processes where the current task, activity, or event name equals the given state name
 * @param {String} stateName.
 * @param {Function} callback
 */
ProcessManager.prototype.findByState = function findByState(stateName, callback) {
  var self = this;

  if (!callback) {
    return;
  }

  this._afterInitialization(function afterInitializationHandler(afterInitializationError) {
    if (afterInitializationError) {
      return callback(afterInitializationError);
    }

    self.getAllProcesses(function getAllProcessesHandler(getAllProcessesError, bpmnProcesses) {
      if (getAllProcessesError) {
        return callback(getAllProcessesError);
      }

      return callback(null, find.findByState(bpmnProcesses, stateName));
    });

    return void 0;
  });
};

/**
 * @param {Object} query The query is an object that is being matched to the data.
 * @param {Function} callback
 */
ProcessManager.prototype.findByProperty = function findByProperty(query, callback) {
  var self = this;

  if (!callback) {
    return;
  }

  this._afterInitialization(function afterInitializationHandler(afterInitializationError) {
    if (afterInitializationError) {
      return callback(afterInitializationError);
    }

    self.getAllProcesses(function getAllProcessesHandler(err, bpmnProcesses) {
      if (err) {
        return callback(err);
      }

      return callback(null, find.findByProperty(bpmnProcesses, query));
    });

    return void 0;
  });
};


/**
 * @param {String} processName
 * @param {Boolean=} caseSensitive
 * @param {Function} callback
 */
ProcessManager.prototype.findByName = function findByName(processName, caseSensitive, callback) {
  var self = this;
  var findByNameCallback = callback;
  var _caseSensitive = caseSensitive;

  if (typeof caseSensitive === 'function') {
    findByNameCallback = caseSensitive;
    _caseSensitive = true;
  }

  if (!findByNameCallback) {
    return;
  }

  this._afterInitialization(function afterInitializationHandler(afterInitializationError) {
    if (afterInitializationError) {
      return findByNameCallback(afterInitializationError);
    }

    self.getAllProcesses(function getAllProcessesHandler(getAllProcessesError, bpmnProcesses) {
      if (getAllProcessesError) {
        return findByNameCallback(getAllProcessesError);
      }

      return findByNameCallback(null, find.findByName(bpmnProcesses, processName, _caseSensitive));
    });

    return void 0;
  });
};

/**
 *
 * @param {Function} callback
 */
ProcessManager.prototype.getDefinitionNames = function getDefinitionNames(callback) {
  var self = this;

  this._afterInitialization(function handler(err) {
    callback(err, Object.keys(self._processDefinitions));
  });
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
 * @param {{createProcessId: function, logLevel: logger.logLevels}=} options
 * @param {Object=} restifyOptions
 * @returns {*}
 */
ProcessManager.prototype.createServer = function createServer(options, restifyOptions) {
  return rest.createServer(this, options, restifyOptions);
};
