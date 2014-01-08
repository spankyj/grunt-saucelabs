module.exports = function(grunt) {
  var _ = (grunt.utils || grunt.util)._,
    request = require('request'),
    SauceTunnel = require('sauce-tunnel'),
    Q = require('q'),
    rqst = request.defaults({
      jar: false
    });

  var TestResult = function(jobId, user, key, testInterval){
    var url = 'https://saucelabs.com/rest/v1/' + user + '/js-tests/status';
    var deferred = Q.defer();

    var requestParams = {
      method: 'post',
      url: url,
      auth: {
        user: user,
        pass: key
      },
      json: true,
      body: {
        "js tests": [jobId],
      }
    };

    var checkStatus = function(){
      
      rqst(requestParams, function(error, response, body){

        if (error){
          deferred.resolve({
            passed: undefined,
            result: {
              message: "Error connecting to api to get test status: " + error.toString()
            }
          });
          return;
        }


        if (!body.completed){
          setTimeout(checkStatus ,testInterval);
        } else {
          deferred.resolve(body['js tests'][0]);
        }

      });
    };

    checkStatus();
    
    return deferred.promise;
  };

  var TestRunner = function(user, key, testInterval) {
    this.user = user;
    this.key = key;
    this.url = 'https://saucelabs.com/rest/v1/' + this.user + '/js-tests';
    this.testInterval = testInterval;
    this.results = [];
  };

  TestRunner.prototype.runTests = function(browsers, urls, framework, tunnelIdentifier, testname, tags, build, onTestComplete, callback){

    var me = this;
    var numberOfJobs = browsers.length * urls.length;

    var addResultPromise = function(promise){
      me.results.push(promise);
      grunt.log.writeln(me.results.length, "/", numberOfJobs, 'tests started');
      if (me.results.length == numberOfJobs){

        Q.all(me.results).then(function(results){
          results = results.map(function(result){
            return result.valueOf().result.passed;
          });

          callback(results);
        });
      }
    };

    urls.forEach(function(url){
      me.runTest(browsers, url, framework, tunnelIdentifier, testname, tags, build, function(taskIds){

        console.log(taskIds);

        taskIds.forEach(function(taskId){
          var resultPromise = new TestResult(taskId, me.user, me.key, me.testInterval);
          addResultPromise(resultPromise);
          resultPromise.then(function(result){
            
            grunt.log.subhead("\nTested %s", url);
            grunt.log.writeln("Platform: %s", result.platform);
            if (result.result.passed === undefined){
              grunt.log.error(result.result.message);
            } else {
              grunt.log.writeln("Passed: %s", result.result.passed);
            }
            grunt.log.writeln("Url %s", result.url);
            
            onTestComplete(result);

          }, function(e){
            grunt.log.error('some error? %s', e);
          });
        });
      });
    });
  };

  TestRunner.prototype.runTest = function(browsers, url, framework, tunnelIdentifier, testname, tags, build, callback){

    var parsePlatforms = function(browsers){
      return browsers.map(function(browser){
        return [browser.platform, browser.browserName, browser.version || ""];
      });
    };

    var requestParams = {
      method: 'post',
      url: this.url,
      auth: {
        user: this.user,
        pass: this.key
      },
      json: true,
      body: {
        platforms: parsePlatforms(browsers),
        url: url,
        framework: framework,
        tunnel: "tunnel-identifier:" + tunnelIdentifier,
        name: testname,
        tags: tags, 
        build: build
      }
    };

    rqst(requestParams, function(error, response, body){

      if (error){
        grunt.log.error("Could not connect to Sauce Labs api: %s", error);
        throw error;
      }

      callback(body['js tests']);

    });
  };

  var defaultsObj = {
    username: process.env.SAUCE_USERNAME,
    key: process.env.SAUCE_ACCESS_KEY,
    identifier: Math.floor((new Date()).getTime() / 1000 - 1230768000).toString(),
    tunneled: true,
    tunnelTimeout: 120,
    testInterval: 1000 * 5,
    testReadyTimeout: 1000 * 5,
    onTestComplete: function() {

    },
    testname: "",
    tags: [],
    browsers: [{}]
  };

  function defaults(data) {
    var result = data;
    result.pages = result.url || result.urls;
    if (!_.isArray(result.pages)) {
      result.pages = [result.pages];
    }
    
    return result;
  }

  function configureLogEvents(tunnel) {
    var methods = ['write', 'writeln', 'error', 'ok', 'debug'];
    methods.forEach(function (method) {
      tunnel.on('log:'+method, function (text) {
        grunt.log[method](text);
      });
      tunnel.on('verbose:'+method, function (text) {
        grunt.verbose[method](text);
      });
    });
  }

  var runTask = function(arg, framework, done){

    var test = new TestRunner(arg.username, arg.key, arg.testInterval);

    if (arg.tunneled){
      var tunnel = new SauceTunnel(arg.username, arg.key, arg.identifier, arg.tunneled, arg.tunnelTimeout);
      grunt.log.writeln("=> Starting Tunnel to Sauce Labs".inverse.bold);

      tunnel.start(function(isCreated) {
        if (!isCreated) {
          grunt.log.error("Could not create tunnel to Sauce Labs");
          done(false);
          return;
        }
        grunt.log.ok("Connected to Saucelabs");

        test.runTests(arg.browsers, arg.pages, framework, arg.identifier, arg.testname, arg.tags, arg.build, arg.onTestComplete, function(status){
          status = status.every(function(passed){ return passed; });
          grunt.log[status ? 'ok' : 'error']("All tests completed with status %s", status);
          tunnel.stop(function() {
            done(status);
          });
        });
      });

    } else {
      test.runTests(arg.browsers, arg.pages, framework, arg.identifier, arg.testname, arg.tags, arg.build, arg.onTestComplete, function(status){
        status = status.every(function(passed){ return passed; });
        grunt.log[status ? 'ok' : 'error']("All tests completed with status %s", status);
        done(status);
      });
    }

    
  }

  grunt.registerMultiTask('saucelabs-jasmine', 'Run Jasmine test cases using Sauce Labs browsers', function() {
    var done = this.async(),
      arg = defaults(this.options(defaultsObj));

    runTask(arg, 'jasmine', done);
    
  });

  grunt.registerMultiTask('saucelabs-qunit', 'Run Qunit test cases using Sauce Labs browsers', function() {
    var done = this.async(),
      arg = defaults(this.options(defaultsObj));

    runTask(arg, 'qunit', done);

  });

  grunt.registerMultiTask('saucelabs-yui', 'Run YUI test cases using Sauce Labs browsers', function() {
    var done = this.async(),
    arg = defaults(this.options(defaultsObj));

    runTask(arg, 'YUI Test', done);

  });

  grunt.registerMultiTask('saucelabs-mocha', 'Run Mocha test cases using Sauce Labs browsers', function() {
    var done = this.async(),
      arg = defaults(this.options(defaultsObj));

    runTask(arg, 'mocha', done);

  });
};
