var express = require('express');
var express_ws = require('express-ws');
var url = require('url');
var groups = require('./groups');
var morgan = require('morgan');
var body_parser = require('body-parser');
var badger = require('./badger');

var apn = require('./apn');

var app = express();

app.use(morgan('dev'));
app.use(body_parser.json());

express_ws(app);

//
// group management
//

app.get('/groups', auth_user, function(req, res) {
  return res.send('not implemented - returns all groups for this user');
});

app.post('/groups', auth_user, function(req, res) {
  return res.send('not implemented - create a new group');
});

app.get('/groups/:group_id', auth_user, function(req, res) {
  return res.send('not implemented - returns group details');
});

//
// room (websocket)
//

app.ws('/groups/connect', function(ws, req, res) {
  var query = url.parse(req.url, true).query;
  var group_id = query.group;

  if (!group_id) {
    throw new Error('`group` query parameter is required');
  }

  var group = groups(group_id);

  // send current group state
  group.get_all(function(err, state) {
    ws.send(JSON.stringify(state));
  });

  function send_updates(update) {
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
    console.log('GROUP [' + group_id + ']', JSON.stringify(message));
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

    var sync_badge = message.sync_badge;
    if (sync_badge) {
      group.sync_badge(sync_badge.user_key, sync_badge.count);
    }
  });
});

//
// badge count sync
//

app.get('/badge/unread', auth_user, function(req, res) {
  return badger.group_badge_count(req.user_id, function(err, count_per_group) {
    if (err) return res.error(err)
    return res.send(count_per_group);
  });
});

app.put('/badge/read', auth_user, function(req, res) {
  Object.keys(req.body).forEach(function(group_id) {
    badger.sync_user_count(group_id, req.user_id, req.body[group_id]);
  });

  // return new badge count for group
  return badger.total_badge_count(req.user_id, function(err, total_badge_count) {
    if (err) return res.error(err);
    return res.send({ unread: total_badge_count });
  });
});


//
// push notifications
//

app.post('/apn', auth_user, function(req, res) {
  var token = req.body.token;
  if (!token) {
    return res.sendStatus(400)
  }

  apn.register_token(req.user_id, token);
  return res.send('ok');
});

//
// middleware
//

function auth_user(req, res, next) {
  var user_id = req.headers['x-cha-userid'];
  if (!user_id) {
    return res.send(401);
  }

  req.user_id = user_id;
  res.error = function(err, status) {
    res.setStatus(status || 500);
    res.send({ error: err.message });
  };

  return next();
}

var port = process.env.PORT || 5000;
app.listen(port);
console.log('listening on port', port);