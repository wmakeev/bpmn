/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var util = require('util');

/**
 * @param {String} flowObjectName
 * @param {Array.<Token>} currentTokens
 * @param {Array.<Token>} foundTokens
 */
function _findTokens(flowObjectName, currentTokens, foundTokens) {
  currentTokens.forEach(function currentTokensIter(token) {
    if (token.position === flowObjectName) {
      foundTokens.push(token);
    }
    if (token.substate) {
      _findTokens(flowObjectName, token.substate.tokens, foundTokens);
    }
  });
}

/**
 * @param {String} flowObjectName
 * @param {String} owningProcessId
 * @constructor
 */
function Token(flowObjectName, owningProcessId) {
  this.position = flowObjectName;
  this.owningProcessId = owningProcessId;
}
exports.Token = Token;

/**
 * @param {String} flowObjectName
 * @param {String} owningProcessId
 * @param {String} calledProcessId
 * @constructor
 */
function CallActivityToken(flowObjectName, owningProcessId, calledProcessId) {
  Token.call(this, flowObjectName, owningProcessId);
  this.substate = null;
  this.calledProcessId = calledProcessId;
}
util.inherits(CallActivityToken, Token);
exports.CallActivityToken = CallActivityToken;

/**
 * @param {BPMNProcessState} state For explicit given states.
 *                           For example, after loading persisted state
 * @constructor
 */
function BPMNProcessState(state) {
  /** @type {Array.<Token>} */
  this.tokens = state && state.tokens ? state.tokens : [];
}
exports.BPMNProcessState = BPMNProcessState;

/**
 * @param {String} flowObjectName
 * @param {String} owningProcessId
 * @param {String=} calledProcessId
 * @return {Token}
 */
BPMNProcessState.prototype.createTokenAt = function createTokenAt(flowObjectName, owningProcessId,
                                                                  calledProcessId) {
  var newToken;

  if (calledProcessId) {
    newToken = new CallActivityToken(flowObjectName, owningProcessId, calledProcessId);
  } else {
    newToken = new Token(flowObjectName, owningProcessId);
  }
  this.tokens.push(newToken);

  return newToken;
};

/**
 * @param {String} flowObjectName
 * @return {Array.<Token>}
 */
BPMNProcessState.prototype.findTokens = function findTokens(flowObjectName) {
  var foundTokens = [];
  _findTokens(flowObjectName, this.tokens, foundTokens);
  return foundTokens;
};

/**
 * @return {Array.<Token>}
 */
BPMNProcessState.prototype.findCallActivityTokens = function findCallActivityTokens() {
  var foundTokens = [];

  this.tokens.forEach(function tokensIter(token) {
    if (token.calledProcessId) {
      foundTokens.push(token);
    }
  });

  return foundTokens;
};

/**
 * @param {String} flowObjectName
 * @return {Token}
 */
BPMNProcessState.prototype.getFirstToken = function getFirstToken(flowObjectName) {
  var tokensAtActivity = this.findTokens(flowObjectName);
  return (tokensAtActivity && tokensAtActivity.length > 0 ? tokensAtActivity[0] : null);
};

/**
 * @param {BPMNFlowObject} flowObject
 */
BPMNProcessState.prototype.removeTokenAt = function removeTokenAt(flowObject) {
  var tokenHasBeenRemoved = false;
  var newTokens = [];
  var oldTokens = this.tokens;

  oldTokens.forEach(function oldTokensIter(token) {
    // we remove a token by copying all references except one token
    if (tokenHasBeenRemoved) {
      newTokens.push(token);
    } else {
      if (token.position === flowObject.name) {
        tokenHasBeenRemoved = true;
      } else {
        newTokens.push(token);
      }
    }
  });

  this.tokens = newTokens;
};

/**
 * @param {BPMNFlowObject} flowObject
 */
BPMNProcessState.prototype.removeAllTokensAt = function removeAllTokensAt(flowObject) {
  var newTokens = [];
  var oldTokens = this.tokens;

  oldTokens.forEach(function forEachIter(token) {
    if (token.position !== flowObject.name) {
      newTokens.push(token);
    }
  });

  this.tokens = newTokens;
};

/**
 * @param {BPMNFlowObject} flowObject
 * @return {Boolean}
 */
BPMNProcessState.prototype.hasTokensAt = function hasTokensAt(flowObject) {
  return (flowObject ? this.hasTokens(flowObject.name) : false);
};

/**
 * @param {String} flowObjectName
 * @return {Boolean}
 */
BPMNProcessState.prototype.hasTokens = function hasTokens(flowObjectName) {
  var tokens = this.findTokens(flowObjectName);
  return (tokens.length > 0);
};

/**
 * @param {BPMNFlowObject} flowObject
 * @return {Number}
 */
BPMNProcessState.prototype.numberOfTokensAt = function numberOfTokensAt(flowObject) {
  var count = 0;

  if (flowObject) {
    this.tokens.forEach(function tokensIter(token) {
      if (flowObject.name === token.position) {
        count++;
      }
    });
  }

  return count;
};

