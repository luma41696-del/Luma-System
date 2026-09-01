import 'package:cloud_firestore/cloud_firestore.dart';

import 'models/records.dart';
import 'session.dart';

/// Reads for everything that is not a task.
///
/// All of it goes straight to Firestore, the way the website does. Security
/// Rules decide what comes back, so a stream that errors is the honest signal
/// that the viewer cannot see that collection — the screens show that rather
/// than an empty list, which would read as "nothing here".
class Repos {
  Repos._();
  static final Repos instance = Repos._();

  FirebaseFirestore get _db => FirebaseFirestore.instance;

  /* -------------------------------------------------------------- clients */

  Stream<List<Client>> clients({int limit = 200}) => _db
      .collection('clients')
      .orderBy('name')
      .limit(limit)
      .snapshots()
      .map((s) => s.docs.map((d) => Client.fromMap(d.id, d.data())).toList());

  Stream<Client> client(String id) => _db
      .collection('clients')
      .doc(id)
      .snapshots()
      .map((d) => Client.fromMap(d.id, d.data() ?? const {}));

  /* ---------------------------------------------------------------- chats */

  /// Only the conversations this person belongs to. The rules allow a chat
  /// manager to read any chat, but a list of every conversation in the company
  /// is not what anyone opens their phone for.
  Stream<List<Chat>> myChats({int limit = 60}) {
    final uid = Session.instance.uid;
    if (uid.isEmpty) return Stream.value(const []);

    return _db
        .collection('chats')
        .where('members', arrayContains: uid)
        .orderBy('lastMessageAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((s) => s.docs.map((d) => Chat.fromMap(d.id, d.data())).toList());
  }

  /// Oldest last: the list is drawn reversed so the newest sits at the bottom
  /// without having to scroll a freshly opened thread.
  Stream<List<Message>> messages(String chatId, {int limit = 100}) => _db
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((s) => s.docs.map((d) => Message.fromMap(d.id, d.data())).toList());

  Future<void> sendMessage(String chatId, String body) async {
    final uid = Session.instance.uid;
    final now = FieldValue.serverTimestamp();

    await _db.collection('chats').doc(chatId).collection('messages').add({
      'senderId': uid,
      'body': body,
      'createdAt': now,
      'readBy': [uid],
    });

    // Keeps the conversation list ordered and previewable without reading
    // every thread's messages.
    await _db.collection('chats').doc(chatId).set({
      'lastMessageAt': now,
      'lastMessage': body.length > 120 ? '${body.substring(0, 120)}…' : body,
    }, SetOptions(merge: true));
  }

  /* ------------------------------------------------------------- requests */

  Stream<List<StaffRequest>> requests({String? employeeId, int limit = 100}) {
    Query<Map<String, dynamic>> query = _db.collection('requests');
    if (employeeId != null) {
      query = query.where('employeeId', isEqualTo: employeeId);
    }
    return query
        .orderBy('createdAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((s) =>
            s.docs.map((d) => StaffRequest.fromMap(d.id, d.data())).toList());
  }

  /* -------------------------------------------------------- announcements */

  Stream<List<Announcement>> announcements({int limit = 40}) => _db
      .collection('announcements')
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((s) => s.docs
          .map((d) => Announcement.fromMap(d.id, d.data()))
          .where((a) => a.isLive)
          .toList());

  /* ----------------------------------------------------------- colleagues */

  Stream<List<Member>> team({int limit = 200}) => _db
      .collection('users')
      .limit(limit)
      .snapshots()
      .map((s) => s.docs.map((d) => Member.fromMap(d.id, d.data())).toList()
        ..sort((a, b) => a.name.compareTo(b.name)));

  /// One lookup for the names a screen needs, cached for the session — a chat
  /// thread would otherwise read the same handful of profiles on every frame.
  final Map<String, Member> _people = {};

  Future<Member?> person(String uid) async {
    if (uid.isEmpty) return null;
    final cached = _people[uid];
    if (cached != null) return cached;

    try {
      final doc = await _db.collection('users').doc(uid).get();
      if (!doc.exists) return null;
      final member = Member.fromMap(doc.id, doc.data() ?? const {});
      _people[uid] = member;
      return member;
    } on Object {
      return null;
    }
  }
}
