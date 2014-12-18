var express = require('express');
var express_ws = require('express-ws');
var url = require('url');
var groups = require('./groups');
var morgan = require('morgan');
var body_parser = require('body-parser');

var apn = require('./apn');

var app = express();

app.use(morgan('dev'));
app.use(body_parser.json());

express_ws(app);

app.ws('/subscribe', function(ws, req, res) {
  var query = url.parse(req.url, true).query;
  var group_id = query.group;
  if (!group_id) {
    throw new Error('`group` query parameter is required');
  }

  console.log('subscribe to group_id', group_id);
  var group = groups(group_id);

  // immediately send all counters
  group.get_all(function(err, counters) {
    ws.send(JSON.stringify(counters));
  });

  function send_updates(update) {
    console.log('sending update', update);
    try {
      ws.send(JSON.stringify(update));
    }
    catch (e) {
      console.log('socket closed');
    }
  }

  // when the group updates, send the update to the client
  group.on('update', send_updates);

  ws.on('close', function() {
    console.log('websocket closed, cleaning up');
    group.removeListener('update', send_updates);
  });

  ws.on('message', function(buff) {
    var message = JSON.parse(buff);
    console.log(message);
    if (!message) {
      return;
    }

    var increment = message.increment;
    if (increment) {
      for (var key in increment) {
        var value = increment[key];
        console.log('increment', key, 'by', value);
        group.increment(key, value);
      }
    }

    var message_metadata = message.message;
    if (message_metadata) {
      group.message(message_metadata);
    }

    var push = message.push;
    if (push) {
      group.push(message.push);
    }

    var join = message.join;
    if (join) {
      group.join(join);
    }

    var leave = message.leave;
    if (leave) {
      group.leave(leave);
    }
  });
});

app.post('/apn', function(req, res) {
  var key = req.body.key;
  var token = req.body.token;
  if (!token || !key) {
    return res.sendStatus(400)
  }

  apn.register_token(key, token);
  return res.send('ok');
});

var port = process.env.PORT || 5000;
app.listen(port);
console.log('listening on port', port);
