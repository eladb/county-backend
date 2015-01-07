var async = require('async');
var express = require('express');
var express_ws = require('express-ws');
var url = require('url');
var groups = require('./groups');
var morgan = require('morgan');
var body_parser = require('body-parser');
var badger = require('./badger');
var users = require('./users');
var util = require('./util');

var apn = require('./apn');

var app = express();

app.use(morgan('dev'));
app.use(body_parser.json());

app.use(function(req, res, next) {
  res.callback = function(on_success) {
    on_success = on_success || function(object) {
      if (object) return res.send(object);
      return res.send({ success: true });
    };

    return function(err, object) {
      if (err) return res.error(err);
      on_success(object);
    };
  };

  return next();
});

express_ws(app);

//
// group management
//

// returns all groups+metadata for this user
app.get('/groups', auth_user, function(req, res) {
  return req.user.all_groups(function(err, ids) {
    if (err) return res.send(err);

    var result = {};
    return async.each(ids, function(group_id, cb) {
      var group = groups(group_id);
      return group.metadata(function(err, metadata) {
        if (err || !metadata) {
          console.log('fake data. cannot find metadata for group', group_id);
          return cb();
        }

        result[group_id] = metadata;
        return cb();
      });
    }, function() {
      return res.send(result);
    });
  });
});

// add a user as a member of a group and group to user group list
app.post('/groups/:group_id/members', auth_user, function(req, res) {
  var group_id = req.params.group_id;
  var user_id = req.user_id;
  return req.user.join_group(group_id, function(err) {
    if (err) return res.error(err);
    return groups(group_id).join(user_id, res.callback(function() {
      return res.send({ joined: group_id });
    }));
  });
});

// remove group from user group list and user from group's member list
app.delete('/groups/:group_id/members', auth_user, function(req, res) {
  var group_id = req.params.group_id;
  var user_id = req.user_id;
  return req.user.leave_group(group_id, function(err) {
    if (err) return callback(err);
    return groups(group_id).leave(user_id, res.callback(function() {
      return res.send({ left: group_id });
    }));
  });
});

// creates a new group and joins the user to the group
app.post('/groups', auth_user, function(req, res) {
  var metadata = req.body;

  // set creator and time based on authenticated user and server time
  var group_id = metadata.group_id;
  var user_id = req.user_id;

  if (!group_id) return res.error(new Error('missing group_id'), 400);

  metadata.group_id = group_id;
  metadata.created_by = user_id;
  metadata.created_at = util.json_date();
  return groups(group_id).update(metadata, function(err) {
    if (err) return res.error(err);
    return req.user.join_group(group_id, res.callback(function() {
      return res.send({ created: group_id });
    }));
  });
});

// returns group metadata
app.get('/groups/:group_id', auth_user, function(req, res) {
  return groups(req.params.group_id).metadata(res.callback());
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

  ws.on('error', function(err) {
    console.log('websocket error:', err);
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

    var message_scorers = message.message_scorers;
    if (message_scorers) {
      for (var key in message_scorers) {
        var dictionary = message_scorers[key];
        console.log('user', dictionary.user, 'scored message', dictionary.message,'with', dictionary.score);
        group.message_scorers(dictionary.user, dictionary.message, dictionary.score);
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
  });
});

//
// badge count sync
//

app.get('/badge/unread', auth_user, function(req, res) {
  return badger.group_badge_count(req.user_id, res.callback());
});

app.put('/badge/read', auth_user, function(req, res) {
  Object.keys(req.body).forEach(function(group_id) {
    badger.sync_user_count(group_id, req.user_id, req.body[group_id]);
  });
  return res.send();
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
  req.user = users(user_id);

  res.error = function(err, status) {
    res.status(status || 500);
    res.send({ error: err.message });
  };

  return next();
}

var port = process.env.PORT || 5000;
app.listen(port);
console.log('listening on port', port);