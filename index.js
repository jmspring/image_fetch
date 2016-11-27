var express = require('express');
var exec = require('child_process').exec;
var app = express();

// Retrieve environment variables
function environment_vars() {
  return {
    "storageAccount":           process.env.AZURE_STORAGE_ACCOUNT_NAME,
    "storageAccountKey":        process.env.AZURE_STORAGE_ACCOUNT_KEY,
    "storageAccountContainer":  process.env.AZURE_STORAGE_ACCOUNT_CONTAINER_NAME,
    "imageUrl":                 process.env.IMAGE_CAPTURE_URL
  }
}

function required_environment_vars_set(vars) {
  if((typeof(vars["storageAccount"]) != "undefined") &&
        (typeof(vars["storageAccountKey"]) != "undefined") &&
        (typeof(vars["storageAccountContainer"]) != "undefined") &&
        (typeof(vars["imageUrl"]) != "undefined")) {
    return true;
  }
  return false;
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
        res.write("Not all required environment variables set.\n");
    }
    res.write(JSON.stringify(env));
    res.write('\n');
    res.end()
  });
});

/* Use PORT environment variable if it exists */
var port = process.env.PORT || 5000;
server = app.listen(port, function () {
  console.log('Server listening on port %d in %s mode', server.address().port, app.settings.env);
});