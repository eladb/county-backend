var groups = {};

var apn = require('./apn');
var redis = require('./redis');
var utils = require('./util');

var redis_subscriber = redis.pubsub();
var redis_client = redis.connect();

var badger = require('./badger');

redis_subscriber.on('ready', function() {
  redis_subscriber.psubscribe('group:*');
  redis_subscriber.on('pmessage', function(pattern, channel, message) {
    var msg = JSON.parse(message);
    var group_id = channel.split(':')[1];
    var group = groups[group_id];
    if (group) {
      group.emit('update', msg);
    }
  });
});

redis_subscriber.on('error', function(err) {
  console.error('cannot connect to redis at', redis_url, '-', err.stack);
});

module.exports = function(group_id) {
  var existing_group = groups[group_id];
  if (existing_group) {
    return existing_group;
  }

  var self = Object.create(new process.EventEmitter());
  self.setMaxListeners(1000);

  groups[group_id] = self;

  function group_key(subkey) {
    var prefix = 'group:' + group_id;
    return subkey ? prefix + ':' + subkey : prefix;
  }

  function publish_to_group(obj) {
    redis_client.publish(group_key(), JSON.stringify(obj));
  }

  // get group metadata
  self.metadata = function(callback) {
    return redis_client.hgetall(group_key(), callback);
  };

  // update group metadata
  self.update = function(metadata, callback) {
    if (!metadata.title)      { return callback(new Error('missing `title`')); }
    if (!metadata.created_by) { return callback(new Error('missing `created_by`')); }
    if (!metadata.created_at) { return callback(new Error('missing `created_at`')); }
    return redis_client.hmset(group_key(), metadata, callback);
  };

  self.increment = function(key, increment) {
    return redis_client.hincrby(group_key('counters'), key, increment, function(err, current_value) {
      if (err) {
        console.error('hincrby error:', err);
        return;
      }

      // notify all subscribers
      var counter_update = {};
      counter_update[key] = current_value;
      publish_to_group({ counters: counter_update });
    });
  };

  self.message = function(metadata) {
    metadata.timestamp = utils.json_date();
    var score = Date.now();
    redis_client.zadd(group_key('messages'), score, JSON.stringify(metadata), function(err) {
      return get_message_count(function(err, message_count) {
        if (err) {
          console.error('error: cannot get message count for group', group_id, '--', err);
          return;
        }

        badger.sync_group_count(group_id, message_count);
      });
    });

    publish_to_group({ messages: [ metadata ] });
  };

  self.push = function(notification) {
    return get_all_members(function(err, members) {
      if (err) {
        console.error('cannot get members to send push:', err);
        return;
      }

      members.forEach(function(user_key) {
        apn.send_push(user_key, notification);
      });
    });
  };

  self.join = function(user_key, callback) {
    callback = callback || function() {};
    return redis_client.sadd(group_key('members'), user_key, callback);
  };

  self.leave = function(user_key, callback) {
    callback = callback || function() {};
    return redis_client.srem(group_key('members'), user_key, callback);
  };

  function get_message_count(callback) {
    return redis_client.zcard(group_key('messages'), callback);
  }

  function get_all_members(callback) {
    return redis_client.smembers(group_key('members'), callback);
  }

  function get_all_counters(callback) {
    return redis_client.hgetall(group_key('counters'), function(err, counters) {
      if (err) {
        return callback(err);
      }

      var output = {};
      for (var key in counters) {
        output[key] = parseInt(counters[key]);
      }

      return callback(null, output);
    });    
  }

  function get_all_messages(callback) {
    return redis_client.zrange(group_key('messages'), 0, -1, function(err, messages) {
      if (err) return callback(err);
      var output = [];
      for (var i = 0; i < messages.length; ++i) {
        output.push(JSON.parse(messages[i]));
      }
      return callback(null, output);
    });
  }

  self.get_all = function(callback) {
    return get_all_counters(function(err, counters) {
      if (err) return callback(err);
      return get_all_messages(function(err, messages) {
        if (err) return callback(err);
        return get_all_members(function(err, members) {
          if (err) return callback(err);
          return callback(null, {
            counters: counters,
            messages: messages,
            members: members,
          });
        });
      });
    });
  };

  return self;
};