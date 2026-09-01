/// What a pairing QR contains, and the rules for believing it.
///
/// The app ships without a server address: this deployment could be on
/// Netlify, on Firebase Hosting, or on a laptop on the office network, so the
/// browser puts its own address into the code it draws.
///
///   luma-pair:1:<32 hex characters>:<https://host/api>
///
/// A scanned code is untrusted input — anyone can print a QR and leave it on a
/// desk — so this parser is deliberately strict, and the screen shows the host
/// before anything is sent to it.
///
/// The strongest guard is elsewhere and worth naming: the Firebase project is
/// compiled into the app. A code pointing at someone else's server can only
/// return a token that server is able to sign, and sign-in rejects any token
/// not signed for this project. A forged QR fails to log in rather than
/// logging you into something else.
class PairingPayload {
  const PairingPayload({required this.code, required this.apiBase});

  final String code;
  final String apiBase;

  static const _prefix = 'luma-pair:1:';

  /// The host, for showing a person what they are about to talk to.
  String get host => Uri.parse(apiBase).host;

  /// The body `redeemPairing` expects.
  ///
  /// It lives here, beside the thing that knows the code, because the first
  /// build shipped without it: the call sent only the device name and the
  /// server answered "الرمز مطلوب". Building the request where the code is
  /// makes that omission impossible to repeat, and testable.
  Map<String, dynamic> redeemRequest(String device) => {
        'code': code,
        'device': device,
      };

  /// Returns null for anything that is not one of our codes, so the scanner
  /// can keep looking instead of failing on the first stray barcode.
  static PairingPayload? tryParse(String raw) {
    final text = raw.trim();
    if (!text.startsWith(_prefix)) return null;

    final rest = text.substring(_prefix.length);
    final separator = rest.indexOf(':');
    if (separator <= 0) return null;

    final code = rest.substring(0, separator);
    final base = rest.substring(separator + 1);

    // The server issues 32 hex characters; anything else is not from us.
    if (!RegExp(r'^[0-9a-f]{32}$').hasMatch(code)) return null;

    final uri = Uri.tryParse(base);
    if (uri == null || !uri.hasAuthority) return null;
    if (uri.scheme != 'https' && !_isLoopback(uri)) return null;

    return PairingPayload(
      code: code,
      apiBase: base.endsWith('/') ? base.substring(0, base.length - 1) : base,
    );
  }

  /// Plain http is allowed only against a machine on the same desk, which is
  /// how the emulators are run during development.
  static bool _isLoopback(Uri uri) {
    if (uri.scheme != 'http') return false;
    final host = uri.host;
    return host == 'localhost' ||
        host == '127.0.0.1' ||
        host == '::1' ||
        host.startsWith('192.168.') ||
        host.startsWith('10.');
  }
}
