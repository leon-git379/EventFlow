# EventFlow — DynamoDB Schemas (5 tables, all PAY_PER_REQUEST)

All tables share a composite key and (except Users) a `GS1` GSI for reverse lookups.
One shared Lambda role reads/writes all five — see `IAM_AND_POLICIES.md`.

## eventflow-users — PK: `uid` (S)
| Attribute | Type | Notes |
|---|---|---|
| `uid` | S | `EF-<user_id>` e.g. `EF-u_7f3a2c` — also the QR payload |
| `user_id` | S | short id used in API payloads |
| `name`, `email`, `phone` | S | registration fields |
| `role` | S | `attendee` \| `organizer` \| `sponsor` |
| `checked_in` | BOOL | set by /checkin under a condition (duplicate-proof) |
| `checked_in_at` | S | ISO timestamp |
| `redeemed_items` | L | denormalized list for quick display |
| `created_at` | S | |

Special row: `uid = "COUNTER#checkins"` (`n` = atomic global headcount) — this is
the emergency headcount number.

## eventflow-queues — PK: `pk`,`sk` · GSI GS1: `gs1pk`,`gs1sk`
| Item | pk | sk | Holds |
|---|---|---|---|
| Queue meta | `QUEUE#food_court` | `meta` | name, `mins_per_token`, `now_serving` |
| Counter | `QUEUE#<id>` | `counter` | `n` (tokens issued), `served_count` — **atomic ADD** |
| Token | `QUEUE#<id>` | `TOKEN#000042` | user_id, token, position, wait_time, served, joined_at, `gs1pk=USER#<uid>`, `gs1sk=QUEUE#<id>#T000042` |

GS1 answers "which queues is this user in?" — the double-tap guard in /queue/join.

## eventflow-booths — PK: `pk`,`sk`
| Item | pk | sk | Holds |
|---|---|---|---|
| Booth meta | `BOOTH#aws` | `meta` | name, occupancy, capacity, hall, visitors_today, updated_at |
| Hall meta | `HALL#A` | `meta` | hall, occupancy, capacity |

## eventflow-inventory — PK: `pk`,`sk`
| Item | pk | sk | Holds |
|---|---|---|---|
| Swag stock | `SPONSOR#aws` | `ITEM#aws_tshirt` | name, quantity, distributed |
| Redemption | `USER#<uid>` | `ITEM#<item_id>` | booth_id, redeemed_at — **attribute_not_exists guard** |

## eventflow-volunteers — PK: `pk`,`sk`
| Item | pk | sk | Holds |
|---|---|---|---|
| Volunteer | `VOL#v1` | `profile` | name, task, zone, status, phone |

## Access patterns
| Pattern | How |
|---|---|
| Check-in duplicate guard | `UpdateItem` condition `checked_in = false` |
| Next token in queue | Query `pk=QUEUE#x, sk begins_with TOKEN#`, filter `served=false`, LIMIT 1 |
| User's active token | GSI query `gs1pk=USER#u, gs1sk begins_with QUEUE#x` |
| Issue token | `UpdateItem` `ADD n 1` on counter (atomic, no read-modify-write) |
| Headcount | `UpdateItem` `ADD n 1` on `COUNTER#checkins` |
| Swag dedupe | `PutItem` condition `attribute_not_exists(pk)` |
| Stock decrement | `UpdateItem` condition `quantity >= 1` with `ADD quantity -1` |
| Booth occupancy ±1 | `UpdateItem` with clamp condition `occupancy + delta >= 0` |

Scan is used only on tiny MVP-sized tables (booths/halls/volunteers/queue meta).
Fine for a demo; would need modeling before real scale.
