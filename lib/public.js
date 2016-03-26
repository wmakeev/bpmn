/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var async = require('async');

var definitions = require('./parsing/definitions.js');
var handlerTools = require('./handler.js');
var bpmnProcesses = require('./process.js');
var logger = require('./logger.js');

var ProcessManager = require('./manager').ProcessManager;

module.exports = exports = new ProcessManager();

exports.ProcessManager = ProcessManager;

exports.clearCache = function clearCache() {
  definitions.clearCache();
};

exports.logLevels = logger.logLevels;

/**
 * A BPMN process is created.
 *
 * @param {String} bpmnFilePath Full qualified file name of the bpmn file to be loaded
 * @param {Function} callback
 * @return {BPMNProcessClient}
 */
exports.createUnmanagedProcess = function createUnmanagedProcess(bpmnFilePath, callback) {
  var processDefinition;
  var error;
  var processDefinitions = definitions.getBPMNProcessDefinitions(bpmnFilePath);
  var handler = handlerTools.getHandlerFromFile(bpmnFilePath);

  if (processDefinitions.length === 1) {
    processDefinition = processDefinitions[0];
  } else {
    error = new Error('The BPMN file "' + bpmnFilePath +
      '". contains more than one process definition. Use "createCollaboratingProcesses"' +
      ' instead of "createProcess"');
    if (!callback) {
      throw error;
    } else {
      callback(error);
    }
  }

  bpmnProcesses.createBPMNProcess(null, processDefinition, handler,
    function createBPMNProcessHandler(err, bpmnProcess) {
      if (!callback) {
        return;
      }

      callback(err, bpmnProcess.processClient);
    });
};

/**
 * A BPMN process is created.
 *
 * @param {String} bpmnXML
 * @param {String|object} handler
 * @param {Function} callback
 * @return {BPMNProcessClient}
 */
exports.createUnmanagedProcessFromXML = function createUnmanagedProcessFromXML(bpmnXML, handler,
                                                                               callback) {
  var processDefinition;
  var error;
  var handlerFunc;
  var processDefinitions = definitions.getBPMNDefinitionsFromXML(bpmnXML, 'Standalone');

  if (processDefinitions.length === 1) {
    processDefinition = processDefinitions[0];
  } else {
    error = new Error('The BPMN XML contains more than one process definition.' +
      ' Use "createCollaboratingProcesses" instead of "createProcess"');
    return callback(error);
  }

  if (typeof handler === 'string') {
    handlerFunc = handlerTools.getHandlerFromString(handler);
  }

  return bpmnProcesses.createBPMNProcess(null, processDefinition, handlerFunc,
    function createBPMNProcessHandler(err, bpmnProcess) {
      callback(err, bpmnProcess.processClient);
    });
};

/**
 * An array of BPMN processes are created.
 *
 * @param {String} bpmnFilePath Full qualified file name of the bpmn file to be loaded
 * @param {Function} callback
 */
exports.createUnmanagedCollaboratingProcesses =
  function createUnmanagedCollaboratingProcesses(bpmnFilePath, callback) {
    var processes = {};
    var processDefinitions = definitions.getBPMNProcessDefinitions(bpmnFilePath);
    var handler = handlerTools.getHandlerFromFile(bpmnFilePath);

    async.eachSeries(processDefinitions, function asyncIter(processDefinition, done) {
      bpmnProcesses.createBPMNProcess(null, processDefinition, handler,
        function createBPMNProcessHandler(err, bpmnProcess) {
          if (err) {
            done(err);
          }
          processes[processDefinition.name] = bpmnProcess;
          done();
        });
    }, function asyncResultHandler(err) {
      var clients = [];

      Object.keys(processes).forEach(function keysIter(name) {
        var bpmnProcess = processes[name];

        var participants = bpmnProcess.getProcessDefinition().getCollaboratingParticipants();

        participants.forEach(function participantsIter(participant) {
          bpmnProcess.addParticipant(participant.name, processes[participant.name]);
        });

        clients.push(bpmnProcess.processClient);
      });

      callback(err, clients);
    });
  };


/**
 * An array of BPMN processes are created.
 *
 * @param {String} bpmnXML
 * @param {String|object} handler
 * @param {Function} callback
 */
exports.createUnmanagedCollaboratingProcessesFromXML =
  function createUnmanagedCollaboratingProcessesFromXML(bpmnXML, handler, callback) {
    var processes = {};
    var _handler = handler;
    var processDefinitions = definitions.getBPMNDefinitionsFromXML(bpmnXML);

    if (typeof _handler === 'string') {
      _handler = handlerTools.getHandlerFromString(_handler);
    }

    async.eachSeries(processDefinitions, function asyncIter(processDefinition, done) {
      bpmnProcesses.createBPMNProcess(null, processDefinition, _handler,
        function createBPMNProcessHandler(err, bpmnProcess) {
          if (err) {
            done(err);
          }
          processes[processDefinition.name] = bpmnProcess;
          done();
        });
    }, function asyncResultHandler(err) {
      var clients = [];

      Object.keys(processes).forEach(function keysIter(name) {
        var bpmnProcess = processes[name];

        var participants = bpmnProcess.getProcessDefinition().getCollaboratingParticipants();

        participants.forEach(function participantsIter(participant) {
          bpmnProcess.addParticipant(participant.name, processes[participant.name]);
        });

        clients.push(bpmnProcess.processClient);
      });

      callback(err, clients);
    });
  };

/**
 * Maps bpmn names to valid handler names.
 * @param {String} bpmnName
 * @type {String}
 */
exports.mapName2HandlerName = function mapName2HandlerName(bpmnName) {
  return handlerTools.mapName2HandlerName(bpmnName);
};

/**
 * Loads, parses, and validates BPMN definitions from bpmnFilePath
 * If validation error occur, an exception of type BPMNParseErrorQueue is thrown.
 * @param {String} bpmnFilePath
 * @param {Boolean=} cache If true, the definitions are cached.
 * @return {Array.<BPMNProcessDefinition|BPMNCollaborationDefinition>}
 */
exports.getBPMNDefinitions = function getBPMNDefinitions(bpmnFilePath, cache) {
  var bpmnDefinitions = null;
  if (cache) {
    bpmnDefinitions = definitions.getCachedBPMNDefinitions(bpmnFilePath);
  } else {
    bpmnDefinitions = definitions.getBPMNDefinitions(bpmnFilePath);
  }
  return bpmnDefinitions;
};
