var path = require('path');
var express = require('express');
var swagger = require('swagger-express-middleware');
var canned = require('canned/lib/canned');
var Promise = require('bluebird');
var xmlparser = require('express-xml-bodyparser');
var $RefParser = require('json-schema-ref-parser');

var SwaggerParser   = require('swagger-parser'),
    Middleware      = swagger.Middleware,
    MemoryDataStore = swagger.MemoryDataStore,
    Resource        = swagger.Resource;

function loadFunctionalSwagger(wd, app, definition, basePath) {
  return new Promise(function(resolve, reject){
    var parser = new SwaggerParser();
    parser.dereference(path.resolve(wd, definition), function(err, definition) {
      if(err) return reject(err);

      basePath = basePath || definition.basePath || '/';
      delete definition.basePath;
      var middleware = new Middleware(app);

      if(basePath.charAt(0) != '/') {
        basePath = '/' + basePath;
      }

      middleware.init(definition, function(err) {
        if(err) return reject(err);
        app.use(
          basePath,
          [
            middleware.metadata(),
            middleware.CORS(),
            middleware.files(),
            middleware.parseRequest(),
            middleware.validateRequest(),
            middleware.mock()
          ]
        );
        resolve(middleware);
      });
    });
  });
}
function loadCannedSwagger(wd, app, definition, basePath, cannedPath) {
  return new Promise(function(resolve, reject){
    var parser = new SwaggerParser();
    parser.dereference(path.resolve(wd, definition), function(err, definition) {
      if(err) return reject(err);

      basePath = basePath || definition.basePath || '/';
      delete definition.basePath;
      var middleware = new Middleware(app);

      if(basePath.charAt(0) != '/') {
        basePath = '/' + basePath;
      }

      middleware.init(definition, function(err) {
        var c = new canned(path.resolve(wd, cannedPath), {
          logger: process.stdout
        });
        app.use(
          basePath,
          [
            middleware.metadata(),
            middleware.CORS(),
            middleware.files(),
            middleware.parseRequest(),
            middleware.validateRequest(),
            c.responseFilter.bind(c)
          ]
        );
        resolve(middleware);
      });
    });
  });
}

var prefixMatch = new RegExp(/(?!xmlns)^.*:/);
function loadSOAP(wd, app, definition, path, cannedPath) {
  return new Promise(function(resolve, reject){
    var c = new canned(cannedPath, {
      logger: process.stdout
    });
    app.use(
      path,
      [
        xmlparser({
          explicitArray: false,
          tagNameProcessors: [function(str) {return str.replace(prefixMatch, '');}]
        }),
        // function (req, res, next) {
        //   console.log(JSON.stringify(req.body, null, 2));
        //   next();
        // },
        c.responseFilter.bind(c)
      ]
    );
    resolve(app);
  });
}

function loadCanned(wd, app, basePath, cannedPath) {
  return new Promise(function(resolve, reject){
    basePath = basePath || '/';

    if(basePath.charAt(0) != '/') {
      basePath = '/' + basePath;
    }

    var c = new canned(path.resolve(wd, cannedPath), {
      logger: process.stdout
    });
    app.use(
      basePath,
      [
        c.responseFilter.bind(c)
      ]
    );
    resolve(true);
  });
}

function Mocker(wd, config) {
  if (!(this instanceof Mocker)) {
    return new Mocker(wd, config);
  }
  self = this;
  this.wd = wd;
  this.config = config;
  this.app = express();

  if(typeof this.config === 'string') {
    this.whenReady = new Promise(function(resolve, reject){
      console.log('Reading :', path.resolve(self.wd, self.config));
      $RefParser.dereference(path.resolve(self.wd, self.config), function(err, parsed) {
        if(err) return reject(err);
        self.config = parsed;
        console.log('Parsed:', parsed);
        resolve(parsed);
      });
    });
  }
}

Mocker.prototype.loadDefinition = function (definition) {
  if(definition.swagger) {
    if (definition.cannedPath) {
      return loadCannedSwagger(this.wd, this.app, definition.swagger, definition.path, definition.cannedPath);
    } else {
      return loadFunctionalSwagger(this.wd, this.app, definition.swagger, definition.path);
    }
  } else if (definition.wsdl) {
    if (definition.cannedPath) {
      return loadSOAP(this.wd, this.app, definition.wsdl, definition.path, definition.cannedPath);
    } else {
      return Promise.reject('invalid configuration: ' + JSON.stringify(definition));
    }
  } else {
    return loadCanned(this.wd, this.app, definition.path, definition.cannedPath);
  }
};

Mocker.prototype.start = function (cb) {
  var self = this;
  var promise = this.whenReady;
  promise
    .then(function(){
      return Promise.all(self.config.definitions.map(function(definition){
        return self.loadDefinition(definition);
      }));
    })
    .then(function (){
      self.app.listen(self.config.port || 8080, function() {
        console.log('The Mock is now running at http://localhost:8080');
      });
    })
    .catch(function(err){
      console.log(err);
    });
};

module.exports = Mocker;
