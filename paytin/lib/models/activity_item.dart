import 'package:flutter/material.dart';

class ActivityItem {
  const ActivityItem({
    required this.icon,
    required this.title,
    required this.date,
    required this.amount,
  });

  final IconData icon;
  final String title;
  final String date;

  /// Negative for money leaving the account.
  final double amount;
}
