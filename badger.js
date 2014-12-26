var async = require('async');
var redis = require('./redis');
var apn = require('./apn');
var users = require('./users');

var debug = 0;

var redis_client = redis.connect();

// indicate the number of messages a user sees for a specific group_id
exports.sync_user_count = function(group_id, user_key, count) {
  redis_client.hset(redis_user_key(user_key), group_id, count);
  apn.send_push(user_key); // update badge count by push to user
};

exports.sync_group_count = function(group_id, count) {
  redis_client.set(redis_group_key(group_id), count);
};

exports.group_badge_count = function(user_key, callback) {
  return users(user_key).all_groups(function(err, group_ids) {
    var joined_groups = {};

    if (!err && group_ids) {
      group_ids.forEach(function(id) {
        joined_groups[id] = true;
      });
    }

    // find all the group counts we have for this user
    return redis_client.hgetall(redis_user_key(user_key), function(err, count_per_group) {
      if (err) return callback(err);

      // sum all the deltas between group_count and client_counts
      var counts = {};

      if (!count_per_group) {
        // no groups
        return callback(null, counts);
      }

      return async.each(Object.keys(count_per_group), function(group_id, cb) {
        return redis_client.get(redis_group_key(group_id), function(err, group_count) {
          if (err) return cb(err);
          
          // if there is no group count or if user is not joined,
          // ignore group
          if (!group_count || !joined_groups[group_id]) {
            group_count = 0;
          }

          var client_count = parseInt(count_per_group[group_id]);
          var group_delta = Math.max(group_count - client_count, 0);

          if (debug && group_count > 0) {
            console.log(JSON.stringify({
              user_id: user_key,
              group_id: group_id,
              group_count: group_count,
              user_count: client_count,
              delta: group_delta,
            }));
          }

          counts[group_id] = group_delta;
          return cb();
        });
      }, function(err) {
        if (err) return callback(err);
        return callback(null, counts);
      });
    });

  });
};

exports.total_badge_count = function(user_key, callback) {
  return exports.group_badge_count(user_key, function(err, count_per_group) {
    if (err) return callback(err);
    var total = 0;
    Object.keys(count_per_group).forEach(function(group_id) {
      total += count_per_group[group_id];
    });
    console.log('BADGE_COUNT', user_key, '=', total);
    return callback(null, total);
  });
};

function redis_group_key(group_id) {
  return 'badger:group:' + group_id;
}

function redis_user_key(user_key) {
  return 'badger:user:' + user_key;
}