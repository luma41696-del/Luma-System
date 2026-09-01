import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'palettes.dart';

/// Which of the website's themes this phone is wearing.
///
/// The choice is per device, not per account: the website already stores its
/// own theme locally, and someone reading in bed wants a dark app without
/// changing what their desktop looks like in the office.
class ThemeController extends ChangeNotifier {
  ThemeController._();
  static final ThemeController instance = ThemeController._();

  static const _key = 'luma.theme';

  LumaPalette _palette = lumaPalettes.first;
  LumaPalette get palette => _palette;

  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final id = prefs.getString(_key);
      if (id != null) _palette = byId(id);
    } on Object {
      // A theme that cannot be read is not worth failing a launch over.
    }
  }

  Future<void> select(String id) async {
    if (id == _palette.id) return;
    _palette = byId(id);
    notifyListeners();

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, id);
    } on Object {
      // The theme still applies for this session.
    }
  }

  /// Falls back to the default rather than throwing — a theme removed from the
  /// site should not brick an app that remembered it.
  static LumaPalette byId(String id) => lumaPalettes.firstWhere(
        (palette) => palette.id == id,
        orElse: () => lumaPalettes.first,
      );
}
