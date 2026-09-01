import 'dart:async';

import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/material.dart';

import '../core/app_colors.dart';
import '../widgets/common.dart';
import 'session.dart';

/// The four states the website uses, with its labels and colours.
enum WorkState {
  online('online', 'متصل'),
  working('working', 'يعمل الآن'),
  breakTime('break', 'استراحة'),
  offline('offline', 'غير متصل');

  const WorkState(this.id, this.label);

  final String id;
  final String label;

  static WorkState from(Object? id) => values.firstWhere(
        (state) => state.id == id,
        orElse: () => WorkState.offline,
      );

  bool get isOnline => this != WorkState.offline;

  Color get color => switch (this) {
        WorkState.online => AppColors.info,
        WorkState.working => AppColors.success,
        WorkState.breakTime => AppColors.warning,
        WorkState.offline => AppColors.grey,
      };
}

/// Who is at their desk.
///
/// This lives in the Realtime Database rather than Firestore for one reason:
/// `onDisconnect()` is run by the *server* when the socket drops. A phone that
/// loses signal in a lift cannot tell anyone it went away, so the server has
/// to do it — otherwise everyone who ever opened the app stays "online"
/// forever.
///
/// The same `status/{uid}` node the website writes, so a person online on
/// their laptop shows as online here too.
class Presence {
  Presence._();
  static final Presence instance = Presence._();

  DatabaseReference get _root => FirebaseDatabase.instance.ref();

  StreamSubscription<DatabaseEvent>? _connected;

  /// Starts publishing this device's presence. Safe to call more than once.
  Future<void> start() async {
    final uid = Session.instance.uid;
    if (uid.isEmpty) return;

    final status = _root.child('status/$uid');

    await _connected?.cancel();
    _connected = _root.child('.info/connected').onValue.listen((event) async {
      if (event.snapshot.value != true) return;

      // Registered before going online, so the server already knows what to
      // write if this connection dies.
      await status.onDisconnect().set({
        'state': WorkState.offline.id,
        'lastChanged': ServerValue.timestamp,
      });

      await status.set({
        'state': WorkState.online.id,
        'lastChanged': ServerValue.timestamp,
        'device': 'phone',
      });
    });
  }

  /// Marks this device offline and stops publishing — used on sign-out, where
  /// waiting for a socket to drop would leave a ghost online.
  Future<void> stop() async {
    final uid = Session.instance.uid;
    await _connected?.cancel();
    _connected = null;
    if (uid.isEmpty) return;

    try {
      await _root.child('status/$uid').set({
        'state': WorkState.offline.id,
        'lastChanged': ServerValue.timestamp,
      });
    } on Object {
      // Signing out matters more than the last write landing.
    }
  }

  /// Everyone's state, keyed by uid. One listener for the whole directory
  /// rather than one per row.
  Stream<Map<String, WorkState>> everyone() =>
      _root.child('status').onValue.map((event) {
        final raw = event.snapshot.value;
        if (raw is! Map) return <String, WorkState>{};

        return {
          for (final entry in raw.entries)
            if (entry.value is Map)
              '${entry.key}': WorkState.from(
                (entry.value as Map)['state'],
              ),
        };
      });

  Stream<WorkState> of(String uid) => _root
      .child('status/$uid/state')
      .onValue
      .map((event) => WorkState.from(event.snapshot.value));
}

/// A small coloured ring on an avatar. Nothing at all when offline in a place
/// where absence is the norm, so a directory is not a wall of grey dots.
class PresenceDot extends StatelessWidget {
  const PresenceDot({
    super.key,
    required this.state,
    this.size = 12,
    this.ringColor,
  });

  final WorkState state;
  final double size;
  final Color? ringColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: state.color,
        shape: BoxShape.circle,
        border: Border.all(
          color: ringColor ?? AppColors.bgSurface,
          width: size / 6,
        ),
      ),
    );
  }
}

/// An avatar that says whether the person is there.
class PresenceAvatar extends StatelessWidget {
  const PresenceAvatar({
    super.key,
    required this.uid,
    required this.name,
    this.url,
    this.size = 44,
    this.ringColor,
    this.state,
  });

  final String uid;
  final String name;
  final String? url;
  final double size;
  final Color? ringColor;

  /// Supplied by a list that already watches everyone at once. A directory of
  /// fifty people should open one subscription, not fifty.
  final WorkState? state;

  @override
  Widget build(BuildContext context) {
    final known = state;
    if (known != null) return _build(known);

    return StreamBuilder<WorkState>(
      stream: Presence.instance.of(uid),
      initialData: WorkState.offline,
      builder: (context, snapshot) => _build(snapshot.data ?? WorkState.offline),
    );
  }

  Widget _build(WorkState state) => Stack(
        clipBehavior: Clip.none,
        children: [
          Avatar(name: name, url: url, size: size),
          PositionedDirectional(
            bottom: -1,
            end: -1,
            child: PresenceDot(
              state: state,
              size: size * .3,
              ringColor: ringColor,
            ),
          ),
        ],
      );
}
