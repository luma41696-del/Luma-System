/**
 * Matching a WhatsApp sender to a client in the system.
 *
 * WhatsApp always gives the number in full international form with no plus —
 * `962791234501`. The client record holds whatever a person typed: `+962 79
 * 123 4501`, `0791234501`, sometimes with dashes. Comparing those as strings
 * finds nothing.
 *
 * Both sides are reduced to digits and compared on the last nine, which is the
 * national significant number for a Jordanian mobile. That is short enough to
 * survive every way the same number gets written and long enough that two
 * different subscribers cannot collide.
 */

/** Digits only, and never the leading zero of a local form. */
function digitsOf(value) {
  return String(value || '').replace(/\D+/g, '');
}

/**
 * The comparable tail of a number.
 *
 * Nine digits because a Jordanian mobile is `7XXXXXXXX` once the country code
 * and any trunk zero are gone. A shorter tail would start matching unrelated
 * numbers; a longer one would stop matching the local spelling.
 */
const TAIL = 9;

function phoneKey(value) {
  const digits = digitsOf(value);
  return digits.length >= TAIL ? digits.slice(-TAIL) : digits;
}

/**
 * WhatsApp's `wa_id` in a form worth storing and displaying.
 * Kept as full digits so a reply can be addressed without guessing.
 */
function normalizeWaId(value) {
  return digitsOf(value);
}

/**
 * @param {string} waId          the sender, as WhatsApp reports it
 * @param {Array<{id,name,phone}>} clients
 * @returns {{id,name}|null}
 */
function matchClient(waId, clients = []) {
  const key = phoneKey(waId);
  if (!key || key.length < TAIL) return null;
  const hit = clients.find((c) => phoneKey(c.phone) === key);
  return hit ? { id: hit.id, name: hit.name || '' } : null;
}

module.exports = { phoneKey, normalizeWaId, matchClient, digitsOf };
