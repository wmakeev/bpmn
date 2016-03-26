/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

/**
 * Subsumes all kind process elements that have incoming and outgoing flows.
 * Name according to http://de.wikipedia.org/wiki/Business_Process_Model_and_Notation#Notation
 * @param {String} bpmnId
 * @param {String} name
 * @param {String} type
 * @constructor
 */
function BPMNFlowObject(bpmnId, name, type) {
  this.bpmnId = bpmnId;
  this.name = name;
  this.type = type;
  this.isFlowObject = true;
}
exports.BPMNFlowObject = BPMNFlowObject;

/**
 * Semantics: emit tokens along all outgoing flows. This is the default behavior
 * @param {BPMNProcess} currentProcess
 * @param {Object} data
 */
BPMNFlowObject.prototype.emitTokens = function emitTokens(currentProcess, data) {
  var self = this;
  currentProcess.onFlowObjectEnd(self.name, data, function onFlowObjectEndHandler() {
    var outgoingSequenceFlows = currentProcess.processDefinition.getOutgoingSequenceFlows(self);
    outgoingSequenceFlows.forEach(function outgoingSequenceFlowsIter(outgoingSequenceFlow) {
      currentProcess.emitTokenAlong(self, outgoingSequenceFlow, data);
    });
  });
};

/**
 * @param {BPMNParseErrorQueue} errorQueue
 */
BPMNFlowObject.prototype.assertName = function assertName(errorQueue) {
  var name = this.name.trim();
  if (name === '') {
    errorQueue.addError('FO1', this, 'Found a ' + this.type +
      ' flow object having no name. BPMN id="' + this.bpmnId + '".');
  }
};

/**
 * @param {BPMNProcessDefinition} processDefinition
 * @param {BPMNParseErrorQueue} errorQueue
 */
BPMNFlowObject.prototype.assertOutgoingSequenceFlows =
  function assertOutgoingSequenceFlows(processDefinition, errorQueue) {
    if (!processDefinition.hasOutgoingSequenceFlows(this)) {
      errorQueue.addError('FO2', this, 'The ' + this.type + ' "' +
        this.name + '" must have at least one outgoing sequence flow.');
    }
  };

/**
 * @param {BPMNProcessDefinition} processDefinition
 * @param {BPMNParseErrorQueue} errorQueue
 */
BPMNFlowObject.prototype.assertOneOutgoingSequenceFlow =
  function assertOneOutgoingSequenceFlow(processDefinition, errorQueue) {
    var outgoingFlows = processDefinition.getOutgoingSequenceFlows(this);
    if (outgoingFlows.length !== 1) {
      errorQueue.addError('FO3', this, 'The ' + this.type + ' "' +
        this.name + '" must have exactly one outgoing sequence flow.');
    }
  };

/**
 * @param {BPMNProcessDefinition} processDefinition
 * @param {BPMNParseErrorQueue} errorQueue
 */
BPMNFlowObject.prototype.assertNoOutgoingSequenceFlows =
  function assertNoOutgoingSequenceFlows(processDefinition, errorQueue) {
    if (processDefinition.hasOutgoingSequenceFlows(this)) {
      errorQueue.addError('FO4', this, 'The ' + this.type + ' "' + this.name +
        '" must not have outgoing sequence flows.');
    }
  };

/**
 * @param {BPMNProcessDefinition} processDefinition
 * @param {BPMNParseErrorQueue} errorQueue
 */
BPMNFlowObject.prototype.assertIncomingSequenceFlows =
  function assertIncomingSequenceFlows(processDefinition, errorQueue) {
    if (!processDefinition.hasIncomingSequenceFlows(this)) {
      errorQueue.addError('FO5', this, 'The ' + this.type + ' "' +
        this.name + '" must have at least one incoming sequence flow.');
    }
  };

/**
 * @param {BPMNProcessDefinition} processDefinition
 * @param {BPMNParseErrorQueue} errorQueue
 */
BPMNFlowObject.prototype.assertNoIncomingSequenceFlows =
  function assertNoIncomingSequenceFlows(processDefinition, errorQueue) {
    if (processDefinition.hasIncomingSequenceFlows(this)) {
      errorQueue.addError('FO5', this, 'The ' + this.type +
        ' "' + this.name + '" must not have incoming sequence flows.');
    }
  };

