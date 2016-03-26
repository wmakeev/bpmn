/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var parserUtils = require('./parserUtils');

/**
 * @param localName name without namespace prefix
 * @return {Boolean}
 */
exports.isMessageFlowName = function isMessageFlowName(localName) {
  return (localName.toLowerCase().indexOf('messageflow') > -1);
};

/**
 * @param {String} bpmnId
 * @param {String} name
 * @param {String} type
 * @param {String} sourceRef
 * @param {String} targetRef
 * @constructor
 */
function BPMNMessageFlow(bpmnId, name, type, sourceRef, targetRef) {
  this.bpmnId = bpmnId;
  this.name = name;
  this.type = type;
  this.sourceRef = sourceRef;
  this.targetRef = targetRef;
  this.targetProcessDefinitionId = null;
  this.sourceProcessDefinitionId = null;
}
exports.BPMNMessageFlow = BPMNMessageFlow;

/**
 * @param node
 * @constructor
 */
exports.createBPMNMessageFlow = function createBPMNMessageFlow(node) {
  var getValue = parserUtils.getAttributesValue;
  return (new BPMNMessageFlow(
    getValue(node, 'id'),
    getValue(node, 'name'),
    node.local,
    getValue(node, 'sourceRef'),
    getValue(node, 'targetRef')
  ));
};
