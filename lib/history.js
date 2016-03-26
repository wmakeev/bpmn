/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var endEvents = require('./parsing/endEvents.js');

var getTimestamp = Date.now;
exports.setTimestampFunction = function setTimestampFunction(getTimestampFunction) {
  getTimestamp = getTimestampFunction;
};
exports.setDummyTimestampFunction = function setDummyTimestampFunction() {
  getTimestamp = function dummy() {
    return '_dummy_ts_';
  };
};

/**
 * @param {String} name
 * @param {String} type
 * @param {Number=} begin Timestamp in ms
 * @param {Number=} end
 * @constructor
 */
function HistoryEntry(name, type, begin, end) {
  this.name = name;
  this.type = type;
  this.begin = begin || getTimestamp();
  this.end = end || null;
}
exports.HistoryEntry = HistoryEntry;

HistoryEntry.prototype.setEnd = function setEnd() {
  this.end = getTimestamp();
};

/**
 * @param {BPMNProcessHistory} history For explicit given history. For example, after loading
 *                             persisted state
 * @constructor
 */
function BPMNProcessHistory(history) {
  /** @type {Array.<HistoryEntry>} */
  this.historyEntries = [];

  if (history) {
    this.historyEntries = history.historyEntries.map(function (historyEntry) {
      var entry = new HistoryEntry(historyEntry.name, historyEntry.type, historyEntry.begin,
        historyEntry.end);
      if (historyEntry.subhistory) {
        entry.subhistory = new BPMNProcessHistory(historyEntry.subhistory);
      }
      return entry;
    });
    this.createdAt = history.createdAt;
    this.finishedAt = history.finishedAt || null;
  } else {
    this.createdAt = getTimestamp();
    this.finishedAt = null;
  }
}
exports.BPMNProcessHistory = BPMNProcessHistory;

/**
 * @param {BPMNFlowObject} flowObject
 */
BPMNProcessHistory.prototype.addEntry = function addEntry(flowObject) {
  this.historyEntries.push(new HistoryEntry(flowObject.name, flowObject.type));
};

/**
 * @param {String} flowObjectName
 * @return {HistoryEntry}
 */
BPMNProcessHistory.prototype.getLastEntry = function getLastEntry(flowObjectName) {
  var lastEntry = null;
  var last = this.historyEntries.length - 1;
  var i;
  var entry;

  for (i = last; i >= 0; i--) {
    entry = this.historyEntries[i];
    if (entry.name === flowObjectName) {
      lastEntry = entry;
      break;
    }
  }

  return lastEntry;
};

/**
 * @param {String} flowObjectName
 */
BPMNProcessHistory.prototype.setEnd = function setEnd(flowObjectName) {
  var historyEntry = this.getLastEntry(flowObjectName);
  historyEntry.setEnd();
  if (endEvents.isEndEventName(historyEntry.type)) {
    this.finishedAt = historyEntry.end;
  }
};

BPMNProcessHistory.prototype.isFinished = function isFinished() {
  if (this.historyEntries.length) {
    return endEvents.isEndEventName(this.historyEntries[this.historyEntries.length - 1].type);
  }

  return false;
};

function _hasBeenVisited(historyEntries, flowObjectName) {
  var found = false;

  historyEntries.forEach(function iter(entry) {
    if (entry.name === flowObjectName) {
      found = true;
    }
  });

  if (!found) {
    historyEntries.forEach(function iter(entry) {
      if (entry.subhistory && _hasBeenVisited(entry.subhistory.historyEntries, flowObjectName)) {
        found = true;
      }
    });
  }

  return found;
}

/**
 * @param {String} flowObjectName
 * @return {Boolean}
 */
BPMNProcessHistory.prototype.hasBeenVisited = function hasBeenVisited(flowObjectName) {
  return _hasBeenVisited(this.historyEntries, flowObjectName);
};
