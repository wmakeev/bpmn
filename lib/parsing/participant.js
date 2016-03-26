/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var parserUtils = require('./parserUtils');

/**
 * @param localName name without namespace prefix
 * @return {Boolean}
 */
exports.isParticipantName = function isParticipantName(localName) {
  return (localName === 'participant');
};

/**
 * @param {String} bpmnId
 * @param {String} name
 * @param {String} type
 * @param {String} processRef
 * @constructor
 */
function BPMNParticipant(bpmnId, name, type, processRef) {
  this.bpmnId = bpmnId;
  this.name = name;
  this.type = type;
  this.processRef = processRef;
}
exports.BPMNParticipant = BPMNParticipant;

/**
 * @param node
 * @constructor
 */
exports.createBPMNParticipant = function createBPMNParticipant(node) {
  var getValue = parserUtils.getAttributesValue;
  return (new BPMNParticipant(
    getValue(node, 'id'),
    getValue(node, 'name'),
    node.local,
    getValue(node, 'processRef')
  ));
};
