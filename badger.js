var redis = require('./redis');
var apn = require('./apn');
var groups = require('./groups');
var async = require('async');

var redis_client = redis.connect('badger');

// indicate the number of messages a user sees for a specific group_id
exports.sync_user_count = function(group_id, user_key, count) {
  redis_client.hset(redis_user_key(user_key), group_id, count);
};

exports.sync_group_count = function(group_id, count) {
  redis_client.set(redis_group_key(group_id), count);
};

exports.group_badge_count = function(user_key, callback) {
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
        
        if (!group_count) {
          group_count = 0;
        }

        var client_count = parseInt(count_per_group[group_id]);
        var group_delta = Math.max(group_count - client_count, 0);
        counts[group_id] = group_delta;
        return cb();
      });
    }, function(err) {
      if (err) return callback(err);
      return callback(null, counts);
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
    return callback(null, total);
  });
};

function redis_group_key(group_id) {
  return 'badger:group:' + group_id;
}

function redis_user_key(user_key) {
  return 'badger:user:' + user_key;
}