/**
 * Platform API errors. Every failure leaves the API as
 *   HTTP <status>  { "error": { "code": "name_taken", "message": "That username is taken.", "nl": "Die gebruikersnaam is al bezet.", "field"?: "username" } }
 * `message` is English (default language), `nl` the Dutch text, so a client can
 * show `t({ en: e.message, nl: e.nl })` directly or map `code` to its own copy.
 */

/** code → [status, en, nl] */
export const ERRORS = {
  bad_request: [400, 'The request is not valid.', 'Het verzoek is ongeldig.'],
  bad_json: [400, 'The request body is not valid JSON.', 'De inhoud van het verzoek is geen geldige JSON.'],
  invalid: [400, 'Some fields are not valid.', 'Sommige velden zijn ongeldig.'],
  invalid_experience: [400, 'The experience data is not valid.', 'De gegevens van de ervaring zijn ongeldig.'],
  unsupported_version: [400, 'This experience format version is not supported.', 'Deze versie van het ervaringsformaat wordt niet ondersteund.'],
  bad_username: [400, 'Usernames are 3–20 characters: a–z, 0–9 and _.', 'Gebruikersnamen hebben 3–20 tekens: a–z, 0–9 en _.'],
  name_filtered: [400, 'That username is not allowed. Please choose another one.', 'Die gebruikersnaam is niet toegestaan. Kies een andere.'],
  weak_password: [400, 'Passwords need at least 8 characters and must not be too easy to guess.', 'Wachtwoorden hebben minstens 8 tekens nodig en mogen niet te makkelijk te raden zijn.'],
  bad_birth_year: [400, 'Please enter a valid birth year.', 'Vul een geldig geboortejaar in.'],
  self: [400, 'You cannot add yourself as a friend.', 'Je kunt jezelf niet als vriend toevoegen.'],
  unauthorized: [401, 'Please log in first.', 'Log eerst in.'],
  bad_credentials: [401, 'Wrong username or password.', 'Verkeerde gebruikersnaam of wachtwoord.'],
  forbidden: [403, 'You are not allowed to do that.', 'Dat mag je niet doen.'],
  origin: [403, 'Requests from this site are not allowed.', 'Verzoeken vanaf deze site zijn niet toegestaan.'],
  restricted: [403, 'Friend requests are turned off for this account.', 'Vriendschapsverzoeken staan uit voor dit account.'],
  limit: [403, 'You have reached the limit for this.', 'Je hebt hiervoor de limiet bereikt.'],
  not_found: [404, 'Not found.', 'Niet gevonden.'],
  user_not_found: [404, 'No player with that username.', 'Geen speler met die gebruikersnaam.'],
  no_request: [404, 'There is no friend request from that player.', 'Er is geen vriendschapsverzoek van die speler.'],
  method_not_allowed: [405, 'That method is not allowed here.', 'Die methode is hier niet toegestaan.'],
  name_taken: [409, 'That username is taken.', 'Die gebruikersnaam is al bezet.'],
  guest_linked: [409, 'This guest progress is already linked to another account.', 'Deze gastvoortgang is al aan een ander account gekoppeld.'],
  already_friends: [409, 'You are already friends.', 'Jullie zijn al vrienden.'],
  already_requested: [409, 'You already sent a friend request.', 'Je hebt al een vriendschapsverzoek gestuurd.'],
  too_large: [413, 'The request is too large.', 'Het verzoek is te groot.'],
  unsupported_media_type: [415, 'Send JSON (Content-Type: application/json).', 'Stuur JSON (Content-Type: application/json).'],
  rate_limited: [429, 'Too many requests. Please wait a moment.', 'Te veel verzoeken. Wacht even.'],
  internal: [500, 'Something went wrong on the server.', 'Er ging iets mis op de server.'],
  unavailable: [503, 'The platform is starting or unavailable. Try again soon.', 'Het platform start op of is niet beschikbaar. Probeer het zo opnieuw.'],
};

export class ApiError extends Error {
  /**
   * @param {string} code key of ERRORS (unknown codes become 400 with the given message)
   * @param {{ field?: string, message?: string, nl?: string, status?: number, headers?: object, details?: any }} [opts]
   */
  constructor(code, opts = {}) {
    const def = ERRORS[code] || [400, opts.message || code, opts.nl || opts.message || code];
    super(opts.message || def[1]);
    this.code = code;
    this.status = opts.status || def[0];
    this.nl = opts.nl || def[2];
    this.field = opts.field;
    this.headers = opts.headers;
    this.details = opts.details;
  }

  toJSON() {
    const e = { code: this.code, message: this.message, nl: this.nl };
    if (this.field) e.field = this.field;
    if (this.details !== undefined) e.details = this.details;
    return { error: e };
  }
}

/** Shorthand: `throw fail('invalid', { field: 'title' })`. */
export const fail = (code, opts) => new ApiError(code, opts);

/** Store-level conflict (unique constraint) — mapped to an ApiError by the API layer. */
export class StoreConflict extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
    this.conflict = true;
  }
}
