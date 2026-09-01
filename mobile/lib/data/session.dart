import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../core/permissions.dart';

/// Who is signed in, and what they are allowed to do.
///
/// Permissions arrive as short codes in the Firebase ID token's custom claims,
/// written by the backend when the account is created or changed. They are read
/// here only to decide what to draw: every privileged action is re-checked
/// server-side, so a tampered client gains nothing but a misleading screen.
class Session extends ChangeNotifier {
  Session._();
  static final Session instance = Session._();

  User? _user;
  Map<String, dynamic> _claims = const {};
  Map<String, dynamic> _profile = const {};

  User? get user => _user;
  String get uid => _user?.uid ?? '';
  bool get isSignedIn => _user != null;

  String get displayName {
    final fromProfile = (_profile['name'] as String?)?.trim();
    if (fromProfile != null && fromProfile.isNotEmpty) return fromProfile;
    return _user?.displayName?.trim().isNotEmpty == true
        ? _user!.displayName!.trim()
        : 'زميل';
  }

  String? get photoUrl =>
      (_profile['photoURL'] as String?) ?? _user?.photoURL;

  String get jobTitle => (_profile['jobTitle'] as String?) ?? '';

  bool get isAdmin => _claims['role'] == 'admin';

  bool get isActive {
    final status = _claims['status'];
    return status == null || status == 'active';
  }

  List<String> get permissions =>
      (_claims['perms'] as List?)?.whereType<String>().toList() ?? const [];

  /// Takes the readable name and checks the short code the token carries.
  /// An unknown name denies, so a typo cannot open a screen by accident.
  bool can(String permission) {
    if (isAdmin) return true;
    if (!isActive) return false;
    final code = Perm.code(permission);
    return code != null && permissions.contains(code);
  }

  bool canAny(List<String> permissions) => permissions.any(can);

  /// Starts watching auth. Called once, before the first frame is drawn.
  Future<void> start() async {
    FirebaseAuth.instance.idTokenChanges().listen(_onUser);
    await _onUser(FirebaseAuth.instance.currentUser);
  }

  Future<void> _onUser(User? user) async {
    _user = user;
    if (user == null) {
      _claims = const {};
      _profile = const {};
      notifyListeners();
      return;
    }

    try {
      final token = await user.getIdTokenResult();
      _claims = token.claims ?? const {};
    } on Object {
      _claims = const {};
    }

    try {
      final doc = await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .get();
      _profile = doc.data() ?? const {};
    } on Object {
      // A profile read can fail on a cold network; the screen still works
      // from the token alone.
      _profile = const {};
    }

    notifyListeners();
  }

  /// Re-reads the profile after the person edits it, so the screens behind
  /// the form show the new values without a restart.
  Future<void> refresh() => _onUser(FirebaseAuth.instance.currentUser);

  Future<void> signOut() => FirebaseAuth.instance.signOut();
}
