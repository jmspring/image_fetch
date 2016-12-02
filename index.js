// image_fetch
//
// required environment variables:
//  AZURE_STORAGE_ACCOUNT_NAME
//  AZURE_STORAGE_ACCOUNT_KEY
//  AZURE_STORAGE_ACCOUNT_CONTAINER_NAME
//  IMAGE_CAPTURE_URL

var express = require('express');
var exec = require('child_process').exec;
var storageApi = require('azure-storage');
var azure = require('azure');
var request = require('request');
var stream = require('stream');
var app = express();


// constants
var lastRetrieval = 0;
var imagesFetched = 0;
var retrieveIssues = 0;
var storeIssues = 0;
var sendIssues = 0;

// Retrieve environment variables
function environment_vars() {
  var captureFrequency = 10; // default to 10 seconds
  if(typeof(process.env.CAPTURE_FREQUNCY) != 'undefined') {
    captureFrequency = parseInt(process.env.CAPTURE_FREQUNCY);
    if(captureFrequncy <= 0) {
      console.log("CAPTURE_FREQUENCY must be greater than 0");
      captureFrequency = 10
    }
  }
  var env = {
    "storageAccount":             process.env.AZURE_STORAGE_ACCOUNT_NAME,
    "storageAccountKey":          process.env.AZURE_STORAGE_ACCOUNT_KEY,
    "storageAccountContainer":    process.env.AZURE_STORAGE_ACCOUNT_CONTAINER_NAME,
    "serviceBusNamespace":        process.env.AZURE_SERVICE_BUS_NAMESPACE,
    "serviceBusQueue":            process.env.AZURE_SERVICE_BUS_QUEUE,
    "serviceBusSharedAccessName": process.env.AZURE_SERVICE_BUS_SHARED_ACCESS_NAME,
    "serviceBusSharedAccessKey":  process.env.AZURE_SERVICE_BUS_SHARED_ACCESS_KEY,
    "imageUrl":                   process.env.IMAGE_CAPTURE_URL,
    "captureFrequency":           captureFrequency
  };
  return env;
}

function required_environment_vars_set(vars) {
  if((typeof(vars["storageAccount"]) != "undefined") &&
        (typeof(vars["storageAccountKey"]) != "undefined") &&
        (typeof(vars["storageAccountContainer"]) != "undefined") &&
        (typeof(vars["imageUrl"]) != "undefined") &&
        (typeof(vars["serviceBusNamespace"]) != "undefined") &&
        (typeof(vars["serviceBusQueue"]) != "undefined") &&
        (typeof(vars["serviceBusSharedAccessName"]) != "undefined") &&
        (typeof(vars["serviceBusSharedAccessKey"]) != "undefined")) {
    return true;
  }
  return false;
}

function timestamp() {
  return Math.floor(Date.now() / 1000);
}

function fetch_image(now, priorImage, env) {
  var blobService = storageApi.createBlobService(env.storageAccount, env.storageAccountKey);
  blobService.createContainerIfNotExists(env.storageAccountContainer, {publicAccessLevel : 'Blob'}, 
                    function(error, result, response) {
    if (error) {
      console.log("Unable to create storage account container: " + env.storageAccountContainer + ", error: " + error);
      storeIssues++;
      fetch_image_timer(null);
    } else {
      var requestSettings = {
         method: 'GET',
         url: env.imageUrl,
         encoding: null
      };
      request(requestSettings, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          var imageStream = new stream.PassThrough();
          imageStream.end(body);
          var blobName = '' + now + '.jpg';
          var imageLength = response.headers['content-length'];
          blobService.createBlockBlobFromStream(env.storageAccountContainer, 
                                                blobName,
                                                imageStream,
                                                imageLength,
                                                function(error, result, response) {
            if(error) {
              // TODO - consider logging the failure
              storeIssues++;
              fetch_image_timer(null);
            } else {              
              imagesFetched++;

              if(priorImage != null) {
                // send message to he queue indicating a new image to compare
                payload = {
                  'timestamp':  now,
                  'prior_image': priorImage,
                  'current_image': blobName
                };
                var svcBusConnectionString = "Endpoint=sb://" + env['serviceBusNamespace'] + 
                                            ".servicebus.windows.net/;SharedAccessKeyName=" +
                                            env['serviceBusSharedAccessName'] + 
                                            ";SharedAccessKey=" + env['serviceBusSharedAccessKey'];
                var serviceBusSvc = new azure.ServiceBusService(svcBusConnectionString);
                serviceBusSvc.sendQueueMessage(env['serviceBusQueue'], JSON.stringify(payload), function(error) {
                  if(error) {
                    // TODO - log error
                    blobName = null;
                    sendIssues++;
                  }
                  fetch_image_timer(blobName);
                })
              } else {
                fetch_image_timer(blobName);
              }
            }
          });
        } else {
          storeIssues++;
          fetch_image_timer(null);
        }
      });
    }
  });
}

function fetch_image_timer(priorImage) {
  var env = environment_vars();
  var now = timestamp();
  if(now - lastRetrieval > env.captureFrequency) {
    // image retrieval only occurs if required environment variables specified.
    if(required_environment_vars_set(env)) {
      fetch_image(now, priorImage, env);
    }
  } else {
    setTimeout(function() {
      fetch_image_timer(priorImage);
    }, 250);
  }
}

// Return a 200 for kubernetes healthchecks
app.get('/healthz', function(req, res) {
  res.status(200).end();
});

app.get('/', function(req, res) {
  var env = environment_vars();

  var poweredBy = process.env.POWERED_BY;
  var release = process.env.WORKFLOW_RELEASE;

  if (typeof(poweredBy) == "undefined") {
  	poweredBy = "Deis";
  }

  exec('hostname', function(error, stdout, stderr) {
    container = "unknown";
    // If exec was successful
    if (error == null) {
      container = stdout.trim();
    }

    res.setHeader('content-type', 'text/plain');
    res.write('Powered by ' + poweredBy + '\nRelease ' + release + ' on ' + container + '\n');

    if(required_environment_vars_set(env) == false) {
        res.write('Not all required environment variables set.\n');
    }
    res.write('Environment variables:\n');
    res.write(JSON.stringify(env));
    res.write('\n');
    res.write('Stats:\n' + '  last image retrieval = ' + lastRetrieval + '\n  images fetched = ' + imagesFetched + '\n');
    res.write('  errors retrieving images = ' + retrieveIssues + '\n  errors storing images = ' + storeIssues + '\n');
    res.write('  errors sending payload = ' + sendIssues + '\n');
    res.write('\n');
    res.end()
  });
});

/* Use PORT environment variable if it exists */
var port = process.env.PORT || 5000;
server = app.listen(port, function () {
  console.log('Server listening on port %d in %s mode', server.address().port, app.settings.env);
});

/* Start the image retrieval timer */
fetch_image_timer(null);
