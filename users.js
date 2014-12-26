var redis = require('./redis');
var async = require('async');
var util = require('./util');

var redis_client = redis.connect();

module.exports = function(user_id) {
  var self = {};

  function redis_key(subkey) {
    var postfix = subkey ? ':' + subkey : '';
    return 'user:' + user_id + postfix;
  }

  // adds the group to the user's group list
  self.join_group = function(group_id, callback) {
    return redis_client.sadd(redis_key('groups'), group_id, callback);
  };

  // removes the group from the user's group list and removes the user from the group's member list
  self.leave_group = function(group_id, callback) {
    return redis_client.srem(redis_key('groups'), group_id, callback);
  }

  self.all_groups = function(callback) {
    return redis_client.smembers(redis_key('groups'), callback);
  };

  return self;
};