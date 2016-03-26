/**
 * Copyright: E2E Technologies Ltd
 */

'use strict';

/**
 *
 * @param {Object} processData
 * @param {String} propertyName
 * @param {String|Number|Boolean|Date} queryValue
 * @returns {Boolean}
 */
var hasMatchingProperty = function hasMatchingProperty(processData, propertyName, queryValue) {
  var isMatching = false;
  var separatorIndex;
  var parent;
  var rest;

  if (processData) {
    separatorIndex = propertyName ? propertyName.indexOf('.') : -1;
    if (separatorIndex > -1) {
      parent = propertyName.substring(0, separatorIndex);
      rest = propertyName.substring(separatorIndex + 1);
      isMatching = hasMatchingProperty(processData[parent], rest, queryValue);
    } else {
      if (processData.hasOwnProperty(propertyName)) {
        if (processData[propertyName] === queryValue) {
          isMatching = true;
        }
      }
    }
  }

  return isMatching;
};

/**
 * @param {Object} processData
 * @param {Object} query
 * @returns {Boolean}
 */
var hasMatchingProperties = function hasMatchingProperties(processData, query) {
  var isMatching = true;
  var queryFields = query ? Object.getOwnPropertyNames(query) : [];

  queryFields.forEach(function iter(queryField) {
    if (isMatching) {  // AND semantics: if it is false once, it stays false
      isMatching = hasMatchingProperty(processData, queryField, query[queryField]);
    }
  });
  return isMatching;
};

/**
 * Returns all processes where the current task, activity, or event name equals the given state name
 * @param {String} stateName.
 * @param {Array.<BPMNProcess | BPMNProcessClient>} bpmnProcesses List of processes the query
 *                                                  is applied to. Default: all loaded processes.
 * @returns {Array.<BPMNProcessClient>}
 */
exports.findByState = function findByState(bpmnProcesses, stateName) {
  var foundProcesses = [];
  var findAll = !stateName;

  bpmnProcesses.forEach(function iter(bpmnProcess) {
    if (findAll || bpmnProcess.getState().hasTokens(stateName)) {
      foundProcesses.push(bpmnProcess.processClient || bpmnProcess);
    }
  });
  return foundProcesses;
};

/**
 * @param {String} processName.
 * @param {Boolean=} caseSensitive
 * @param {Array.<BPMNProcess | BPMNProcessClient>} bpmnProcesses List of processes the query
 *                                                  is applied to. Default: all loaded processes.
 * @returns {Array.<BPMNProcessClient>}
 */
exports.findByName = function findByName(bpmnProcesses, processName, caseSensitive) {
  var foundProcesses = [];
  var compare = function compare(a, b) {
    var result;
    if (caseSensitive === undefined || caseSensitive) {
      result = (a === b);
    } else {
      result = (a.toLowerCase() === b.toLowerCase());
    }
    return result;
  };

  if (processName) {
    bpmnProcesses.forEach(function iter(bpmnProcess) {
      var name = bpmnProcess.getProcessDefinition().name;
      if (compare(name, processName)) {
        foundProcesses.push(bpmnProcess.processClient || bpmnProcess);
      }
    });
  }
  return foundProcesses;
};

/**
 * @param {Object} query The query is an object that is being matched to the data.
 * @param {Array.<BPMNProcess | BPMNProcessClient>} bpmnProcesses List of processes the query is
 *                                                  applied to. Default: all loaded processes.
 * @returns {Array.<BPMNProcessClient>}
 */
exports.findByProperty = function findByProperty(bpmnProcesses, query) {
  var foundProcesses = [];
  var findAll = !query;

  bpmnProcesses.forEach(function iter(bpmnProcess) {
    if (findAll || hasMatchingProperties(bpmnProcess.getProperties(), query)) {
      foundProcesses.push(bpmnProcess.processClient || bpmnProcess);
    }
  });
  return foundProcesses;
};

