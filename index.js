var path = require('path');
var express = require('express');
var swagger = require('sn-swagger-express-middleware');
var canned = require('sn-canned/lib/canned');
var Promise = require('bluebird');
var bodyParser = require('body-parser');
var xmlparser = require('express-xml-bodyparser');
var $RefParser = require('json-schema-ref-parser');
var multer = require('multer');
var upload = multer({ dest: 'uploads/' })

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
function loadModeledSwagger(wd, app, definition, basePath, modeledPath) {
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
          logger: process.stdout,
          cors: true,
          cors_headers: ["Content-Type", "Location"]
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
          logger: process.stdout,
          cors: true,
          cors_headers: ["Content-Type", "Location"]
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
      logger: process.stdout,
      cors: true,
      cors_headers: ["Content-Type", "Location"]
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
      logger: process.stdout,
      cors: true,
      cors_headers: ["Content-Type", "Location"]
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
function loadModeled(wd, app, basePath, modeledPath) {
  return new Promise(function(resolve, reject){
    basePath = basePath || '/';

    if(basePath.charAt(0) != '/') {
      basePath = '/' + basePath;
    }

    var models = require(path.resolve(wd, modeledPath));

    models.forEach(function(model) {
      app[model.method || 'use'](
        basePath + model.path,
        [
          bodyParser.json(),
          bodyParser.text(),
          bodyParser.urlencoded(),
          upload.any(),
          function(req, res) {
            model.handler(req.body, {headers: req.headers, query: req.query, params: req.params, cookies: req.cookies}, function(err, result, options) {
              options = options || {};
              res.status(options.statusCode || 500);
              if(options.headers) {
                res.set(options.headers);
              }
              var jsonpCallback = options.jsonpCallback || 'callback';
              if(req.method === 'GET' && req.query[jsonpCallback]) {
                  app.set('jsonp callback name', jsonpCallback);
                  res.jsonp(result)
              } else {
                  res.send(result);
              }
            });
          }
        ]
      );
    });
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
    } else if (definition.modeledPath) {
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
    if (definition.cannedPath) {
      return loadCanned(this.wd, this.app, definition.path, definition.cannedPath);
    } else if (definition.modeledPath) {
      return loadModeled(this.wd, this.app, definition.path, definition.modeledPath);
    } else {
      return Promise.reject('invalid configuration: ' + JSON.stringify(definition));
    }

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
      self.app.listen(process.env.PORT || self.config.port || 8080, function() {
        console.log('The Mock is now running at http://localhost:' + (process.env.PORT || self.config.port || 8080));
      });
    })
    .catch(function(err){
      console.log(err);
    });
};

module.exports = Mocker;
