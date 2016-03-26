/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var util = require('util');
var parserUtils = require('./parserUtils.js');
var BPMNFlowObject = require('./flowObject.js').BPMNFlowObject;

/**
 * @param localName name without namespace prefix
 * @return {Boolean}
 */
exports.isEndEventName = function isEndEventName(localName) {
  return (localName.toLowerCase().indexOf('end') > -1);
};

/**
 * Subsumes all kind of end events
 * @param {String} bpmnId
 * @param {String} name
 * @param {String} type
 * @constructor
 */
function BPMNEndEvent(bpmnId, name, type) {
  BPMNFlowObject.call(this, bpmnId, name, type);
  this.isEndEvent = true;
}
util.inherits(BPMNEndEvent, BPMNFlowObject);
exports.BPMNEndEvent = BPMNEndEvent;

/**
 * Semantics: emit token to the parent process - if there is one. Otherwise we are at the end
 *            of the main process and thus delete it from the cache.
 * @param {BPMNProcess} currentProcess
 * @param {Object} data
 */
BPMNEndEvent.prototype.emitTokens = function emitTokens(currentProcess, data) {
  var endEventName = this.name;
  var parentProcess = currentProcess.parentProcess;
  var currentCallActivityName;

  currentProcess.onFlowObjectEnd(endEventName, data, function onFlowObjectEndHandler() {
    if (parentProcess) {
      currentCallActivityName = currentProcess.parentToken.position;
      currentProcess.onProcessEnd(endEventName);
      parentProcess.emitActivityEndEvent(currentCallActivityName, data);
    } else {
      currentProcess.onProcessEnd(endEventName, true);
    }
  });
};

/**
 * @param {BPMNProcessDefinition} processDefinition
 * @param {BPMNParseErrorQueue} errorQueue
 */
BPMNEndEvent.prototype.validate = function validate(processDefinition, errorQueue) {
  this.assertName(errorQueue);
  this.assertIncomingSequenceFlows(processDefinition, errorQueue);
  this.assertNoOutgoingSequenceFlows(processDefinition, errorQueue);
};

/**
 * @param node
 * @return {BPMNEndEvent}
 */
exports.createBPMNEndEvent = function createBPMNEndEvent(node) {
  var getValue = parserUtils.getAttributesValue;
  return (new BPMNEndEvent(
    getValue(node, 'id'),
    getValue(node, 'name'),
    node.local
  ));
};
