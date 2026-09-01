import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../core/app_colors.dart';

/// Firestore hands back a Timestamp, but documents written by older clients
/// can carry a number or an ISO string. Shared by every model here.
DateTime? asDate(Object? value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
  if (value is String) return DateTime.tryParse(value);
  return null;
}

String asText(Object? value) => (value as String?)?.trim() ?? '';

/* --------------------------------------------------------------- clients */

class Client {
  const Client({
    required this.id,
    required this.name,
    required this.status,
    this.logoUrl,
    this.contactPerson = '',
    this.accountManagerId = '',
    this.services = const [],
    this.phone = '',
    this.email = '',
    this.contractEnd,
  });

  final String id;
  final String name;
  final String status;
  final String? logoUrl;
  final String contactPerson;
  final String accountManagerId;
  final List<String> services;
  final String phone;
  final String email;
  final DateTime? contractEnd;

  factory Client.fromMap(String id, Map<String, dynamic> data) => Client(
        id: id,
        name: asText(data['name']),
        status: asText(data['status']).isEmpty ? 'active' : asText(data['status']),
        logoUrl: data['logoURL'] as String?,
        contactPerson: asText(data['contactPerson']),
        accountManagerId: asText(data['accountManagerId']),
        services: (data['services'] as List?)?.whereType<String>().toList() ?? const [],
        phone: asText(data['phone']),
        email: asText(data['email']),
        contractEnd: asDate(data['contractEnd']),
      );

  bool get isActive => status == 'active';

  String get statusLabel => switch (status) {
        'active' => 'نشط',
        'paused' => 'متوقف مؤقتاً',
        'ended' => 'منتهٍ',
        'lead' => 'عميل محتمل',
        _ => status,
      };

  Color get statusColor => switch (status) {
        'active' => AppColors.success,
        'paused' => AppColors.warning,
        'ended' => AppColors.grey,
        'lead' => AppColors.info,
        _ => AppColors.grey,
      };
}

/* ----------------------------------------------------------------- chats */

class Chat {
  const Chat({
    required this.id,
    required this.name,
    required this.type,
    required this.members,
    this.lastMessageAt,
    this.lastMessage = '',
  });

  final String id;
  final String name;
  final String type;
  final List<String> members;
  final DateTime? lastMessageAt;
  final String lastMessage;

  factory Chat.fromMap(String id, Map<String, dynamic> data) => Chat(
        id: id,
        name: asText(data['name']),
        type: asText(data['type']).isEmpty ? 'group' : asText(data['type']),
        members: (data['members'] as List?)?.whereType<String>().toList() ?? const [],
        lastMessageAt: asDate(data['lastMessageAt']),
        lastMessage: asText(data['lastMessage']),
      );

  bool get isDirect => type == 'direct';

  IconData get icon => switch (type) {
        'direct' => Icons.person_rounded,
        'department' => Icons.apartment_rounded,
        'manager' => Icons.shield_rounded,
        _ => Icons.groups_rounded,
      };
}

class Message {
  const Message({
    required this.id,
    required this.senderId,
    required this.body,
    this.createdAt,
    this.attachment,
  });

  final String id;
  final String senderId;
  final String body;
  final DateTime? createdAt;
  final Map<String, dynamic>? attachment;

  factory Message.fromMap(String id, Map<String, dynamic> data) => Message(
        id: id,
        senderId: asText(data['senderId']),
        body: asText(data['body']),
        createdAt: asDate(data['createdAt']),
        attachment: data['attachment'] as Map<String, dynamic>?,
      );
}

/* -------------------------------------------------------------- requests */

class StaffRequest {
  const StaffRequest({
    required this.id,
    required this.type,
    required this.status,
    this.requestNo = '',
    this.employeeId = '',
    this.reason = '',
    this.days,
    this.amount,
    this.fromDate,
    this.createdAt,
  });

  final String id;
  final String type;
  final String status;
  final String requestNo;
  final String employeeId;
  final String reason;
  final num? days;
  final num? amount;
  final DateTime? fromDate;
  final DateTime? createdAt;

  factory StaffRequest.fromMap(String id, Map<String, dynamic> data) =>
      StaffRequest(
        id: id,
        type: asText(data['type']),
        status: asText(data['status']).isEmpty ? 'submitted' : asText(data['status']),
        requestNo: asText(data['requestNo']),
        employeeId: asText(data['employeeId']),
        reason: asText(data['reason']),
        days: data['days'] as num?,
        amount: data['amount'] as num?,
        fromDate: asDate(data['fromDate']),
        createdAt: asDate(data['createdAt']),
      );

  /// Mirrors REQUEST_TYPES in js/documents.js.
  String get typeLabel => switch (type) {
        'leave' => 'طلب إجازة',
        'departure' => 'طلب مغادرة / خروج مبكر',
        'late' => 'إذن تأخير عن الدوام',
        'advance' => 'طلب سلفة على الراتب',
        'sick' => 'طلب إجازة مرضية',
        _ => 'طلب',
      };

  IconData get typeIcon => switch (type) {
        'leave' => Icons.beach_access_rounded,
        'departure' => Icons.logout_rounded,
        'late' => Icons.alarm_rounded,
        'advance' => Icons.account_balance_wallet_rounded,
        'sick' => Icons.medical_services_rounded,
        _ => Icons.description_rounded,
      };

  String get statusLabel => switch (status) {
        'draft' => 'مسودة',
        'submitted' => 'مقدَّم',
        'review' => 'قيد المراجعة',
        'approved' => 'موافق عليه',
        'rejected' => 'مرفوض',
        'cancelled' => 'ملغى',
        _ => status,
      };

  Color get statusColor => switch (status) {
        'approved' => AppColors.success,
        'rejected' => AppColors.danger,
        'review' => AppColors.info,
        'submitted' => AppColors.warning,
        _ => AppColors.grey,
      };

  /// Only these are still waiting on somebody.
  bool get isPending => status == 'submitted' || status == 'review';
}

/* --------------------------------------------------------- announcements */

class Announcement {
  const Announcement({
    required this.id,
    required this.title,
    required this.body,
    required this.kind,
    this.createdByName = '',
    this.createdAt,
    this.expiresAt,
  });

  final String id;
  final String title;
  final String body;
  final String kind;
  final String createdByName;
  final DateTime? createdAt;
  final DateTime? expiresAt;

  factory Announcement.fromMap(String id, Map<String, dynamic> data) =>
      Announcement(
        id: id,
        title: asText(data['title']),
        body: asText(data['body']),
        kind: asText(data['kind']).isEmpty ? 'general' : asText(data['kind']),
        createdByName: asText(data['createdByName']),
        createdAt: asDate(data['createdAt']),
        expiresAt: asDate(data['expiresAt']),
      );

  /// An announcement with no end date runs forever; one with a past end date
  /// is history, not news.
  bool get isLive {
    final ends = expiresAt;
    return ends == null || ends.isAfter(DateTime.now());
  }

  String get kindLabel => switch (kind) {
        'holiday' => 'إجازة / عطلة',
        'urgent' => 'عاجل',
        _ => 'إعلان عام',
      };

  IconData get kindIcon => switch (kind) {
        'holiday' => Icons.beach_access_rounded,
        'urgent' => Icons.warning_amber_rounded,
        _ => Icons.campaign_rounded,
      };

  Color get kindColor => switch (kind) {
        'holiday' => AppColors.success,
        'urgent' => AppColors.danger,
        _ => AppColors.brandLight,
      };
}

/* ------------------------------------------------------------ colleagues */

class Member {
  const Member({
    required this.id,
    required this.name,
    this.jobTitle = '',
    this.department = '',
    this.photoUrl,
    this.status = 'active',
  });

  final String id;
  final String name;
  final String jobTitle;
  final String department;
  final String? photoUrl;
  final String status;

  factory Member.fromMap(String id, Map<String, dynamic> data) => Member(
        id: id,
        name: asText(data['displayName']).isEmpty
            ? asText(data['name'])
            : asText(data['displayName']),
        jobTitle: asText(data['jobTitle']),
        department: asText(data['department']),
        photoUrl: data['photoURL'] as String?,
        status: asText(data['status']).isEmpty ? 'active' : asText(data['status']),
      );

  bool get isActive => status == 'active';
}
