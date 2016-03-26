/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var parserUtils = require('./parserUtils');

/**
 * @param localName name without namespace prefix
 * @return {Boolean}
 */
exports.isCollaborationDefinitionName = function isCollaborationDefinitionName(localName) {
  return (localName === 'collaboration');
};

/**
 * @param {String} bpmnId
 * @constructor
 */
function BPMNCollaborationDefinition(bpmnId) {
  this.bpmnId = bpmnId;
  this.participants = [];
  this.messageFlows = [];
  this.isCollaborationDefinition = true;
}
exports.BPMNCollaborationDefinition = BPMNCollaborationDefinition;

/**
 * @param {BPMNParticipant} participant
 */
BPMNCollaborationDefinition.prototype.addParticipant = function addParticipant(participant) {
  this.participants.push(participant);
};

/**
 * @param {String} processBbpmnId
 * @return {BPMNParticipant}
 */
BPMNCollaborationDefinition.prototype.getParticipantByProcessId =
  function getParticipantByProcessId(processBbpmnId) {
    var participants = this.participants.filter(function participantsIter(participant) {
      return (participant.processRef === processBbpmnId);
    });
    if (participants.length > 1) {
      throw new Error('Cannot uniquely assign a pool to the process whith the BPMN ID "'
        + processBbpmnId + '"');
    }
    return participants[0];
  };

/**
 * Get all participants the process is collaborating with
 * @param {String} processBbpmnId
 * @return {Array.<BPMNParticipant>}
 */
BPMNCollaborationDefinition.prototype.getCollaboratingParticipants =
  function getCollaboratingParticipants(processBbpmnId) {
    return this.participants.filter(function participantsIter(participant) {
      return (participant.processRef !== processBbpmnId);
    });
  };

/**
 * @param {BPMNMessageFlow} messageFlow
 */
BPMNCollaborationDefinition.prototype.addMessageFlow = function addMessageFlow(messageFlow) {
  this.messageFlows.push(messageFlow);
};

/**
 * @return {Array.<BPMNMessageFlow>}
 */
BPMNCollaborationDefinition.prototype.getMessageFlows = function getMessageFlows() {
  return this.messageFlows;
};

/**
 * @param node
 * @return {BPMNCollaborationDefinition}
 */
exports.createBPMNCollaborationDefinition = function createBPMNCollaborationDefinition(node) {
  var getValue = parserUtils.getAttributesValue;
  return (new BPMNCollaborationDefinition(getValue(node, 'id')));
};
