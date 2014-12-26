## redis

 * `group:(gid)`: <hash> of group metadata: `title`, `created_by`, `created_at`, ...
 * `group:(gid):counters`: <hash> of current group counter values
 * `group:(gid):messages`: <sorted set> of messages in the room ordered by timestamp
 * `group:(gid):members`:  <set> of all member_ids in the group
 
 * `user:(uid)`: <hash> of user profile
 * `user:(uid):groups`: <set> of all group_ids this user belongs to
