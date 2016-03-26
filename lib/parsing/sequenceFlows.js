/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var parserUtils = require('./parserUtils');

/**
 * @param localName name without namespace prefix
 * @return {Boolean}
 */
exports.isSequenceFlowName = function isSequenceFlowName(localName) {
  return (localName.toLowerCase().indexOf('sequenceflow') > -1);
};

/**
 * @param {String} bpmnId
 * @param {String} name
 * @param {String} type
 * @param {String} sourceRef
 * @param {String} targetRef
 * @constructor
 */
function BPMNSequenceFlow(bpmnId, name, type, sourceRef, targetRef) {
  this.bpmnId = bpmnId;
  this.name = name;
  this.type = type;
  this.sourceRef = sourceRef;
  this.targetRef = targetRef;
  this.isSequenceFlow = true;
}
exports.BPMNSequenceFlow = BPMNSequenceFlow;

/**
 * @param node
 * @constructor
 */
exports.createBPMNSequenceFlow = function createBPMNSequenceFlow(node) {
  var getValue = parserUtils.getAttributesValue;

  return (new BPMNSequenceFlow(
    getValue(node, 'id'),
    getValue(node, 'name'),
    node.local,
    getValue(node, 'sourceRef'),
    getValue(node, 'targetRef')
  ));
};
