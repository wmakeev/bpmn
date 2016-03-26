/**
 * Copyright: E2E Technologies Ltd
 */
'use strict';

var fileUtils = require('./utils/file.js');

exports.handlerNameSeparator = '$';

/**
 * @param {String} bpmnFilePath
 * @return {String}
 */
function getHandlerFileName(bpmnFilePath) {
  return (fileUtils.removeFileExtension(bpmnFilePath) + '.js');
}
exports.getHandlerFileName = getHandlerFileName;

/**
 * Replace all non-allowed characters with '_', if the name starts with a number prefix it with '_'
 * @param {String} name
 * @return {String}
 */
function mapName2HandlerName(name) {
  var cleanName = name.replace(/[:!`~\^@*#¢¬ç?¦\|&;%@"<>\(\){}\[\]\+, \t\n]/g, '_');

  if (cleanName.match(/^[0-9]/)) {
    cleanName = '_' + cleanName;
  }
  return cleanName;
}
exports.mapName2HandlerName = mapName2HandlerName;

/**
 * @param {String} name
 * @param {BPMNProcess} process
 * @return {Function | Object}
 */
function getHandlerFromProcess(name, process) {
  var handlerName = mapName2HandlerName(name);
  return process.eventHandler[handlerName]; // this works as long as event names are unique
}
exports.getHandlerFromProcess = getHandlerFromProcess;

/**
 * @param {String} name
 * @param {BPMNProcess} process
 * @param {Object=} data
 * @param {Function=} handlerDoneCallback
 */
exports.callHandler = function callHandler(name, process, data, handlerDoneCallback) {
  var result;
  var handlerType;
  var done = handlerDoneCallback || function noop() {};
  var eventType = 'callHandler';
  var handler = getHandlerFromProcess(name, process);

  if (handler) {
    handlerType = typeof handler;
    if (handlerType === 'function') {
      try {
        result = handler.call(process.processClient, data, done);
      } catch (error) {
        process.logger.error('Error in handler "' + name + '": ' + error.toString());
        process.defaultErrorHandler.call(process.processClient, error, done);
      }
    } else if (handlerType === 'object') {
      // hierarchical handler used for mocking up sub process handlers.
      // See test cases for examples.
      // To keep going we have to call done()
      done();
    } else {
      process.callDefaultEventHandler(eventType, name, mapName2HandlerName(name),
        'Unknown handler type: "' + handlerType + '"', done);
    }
  } else {
    process.callDefaultEventHandler(eventType, name, mapName2HandlerName(name),
      'No handler found', done);
  }

  return result;
};

/**
 * @param {String} bpmnFilePath
 * @return {Object}
 */
exports.getHandlerFromFile = function getHandlerFromFile(bpmnFilePath) {
  var handlerFilePath = getHandlerFileName(bpmnFilePath);
  return require(handlerFilePath);
};

function stripBOM(content) {
  var contentVar = content;
  // Remove byte order marker. This catches EF BB BF (the UTF-8 BOM)
  // because the buffer-to-string conversion in `fs.readFileSync()`
  // translates it to FEFF, the UTF-16 BOM.
  if (contentVar.charCodeAt(0) === 0xFEFF) {
    contentVar = contentVar.slice(1);
  }
  return contentVar;
}

/**
 * @param {String} moduleString
 * @return {Object}
 */
exports.getHandlerFromString = function getHandlerFromString(moduleString) {
  var Module = require('module').Module;
  var handlerModule = new Module();
  handlerModule._compile(stripBOM(moduleString));
  return handlerModule.exports;
};

