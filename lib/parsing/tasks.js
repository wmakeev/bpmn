/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var util = require('util');
var parserUtils = require('./parserUtils');

var BPMNActivity = require('./activity.js').BPMNActivity;

/**
 * @param localName name without namespace prefix
 * @return {Boolean}
 */
exports.isTaskName = function isTaskName(localName) {
  return (localName.toLowerCase().indexOf('task') > -1);
};

/**
 * Subsumes all kind of tasks
 * @param {String} bpmnId
 * @param {String} name
 * @param {String} type
 * @constructor
 */
function BPMNTask(bpmnId, name, type) {
  BPMNActivity.call(this, bpmnId, name, type);
  this.isWaitTask = type === 'task' || type === 'userTask' || type === 'receiveTask' ||
    type === 'manualTask';
}
util.inherits(BPMNTask, BPMNActivity);
exports.BPMNTask = BPMNTask;

/**
 * @param {BPMNProcessDefinition} processDefinition
 * @param {BPMNParseErrorQueue} errorQueue
 */
BPMNTask.prototype.validate = function validate(processDefinition, errorQueue) {
  this.assertName(errorQueue);
  this.assertIncomingSequenceFlows(processDefinition, errorQueue);
  this.assertOutgoingSequenceFlows(processDefinition, errorQueue);
};

/**
 * @param node
 * @constructor
 */
exports.createBPMNTask = function createBPMNTask(node) {
  var getValue = parserUtils.getAttributesValue;

  return (new BPMNTask(
    getValue(node, 'id'),
    getValue(node, 'name'),
    node.local
  ));
};
