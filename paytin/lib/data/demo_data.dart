import 'package:flutter/material.dart';

import '../models/activity_item.dart';
import '../models/contact.dart';
import '../models/month_spending.dart';

/// Static sample content so every screen has something to show.
abstract final class DemoData {
  static const userName = 'William Current';
  static const balance = 25453.00;
  static const cardNumberTail = '7281';
  static const cardExp = '07/26';

  static const monthlyEarningPct = 24;
  static const monthlySpending = 3250.80;
  static const goalCurrent = 2567.0;
  static const goalTarget = 5000.0;

  static const contacts = <Contact>[
    Contact('Azie', Color(0xFFF3B9A6)),
    Contact('Chaoir', Color(0xFF8CC7F0)),
    Contact('Fandit', Color(0xFFB9E4A8)),
    Contact('Happy', Color(0xFFF2C879)),
    Contact('Nayu', Color(0xFFC9B8F0)),
  ];

  static const recentActivity = <ActivityItem>[
    ActivityItem(
      icon: Icons.shopping_basket_outlined,
      title: 'Food Store',
      date: 'Monday, 25 January',
      amount: -15,
    ),
    ActivityItem(
      icon: Icons.home_work_outlined,
      title: 'House Rent',
      date: 'Monday, 25 January',
      amount: -290,
    ),
    ActivityItem(
      icon: Icons.subscriptions_outlined,
      title: 'Subscription',
      date: 'Sunday, 24 January',
      amount: -27,
    ),
    ActivityItem(
      icon: Icons.shopping_basket_outlined,
      title: 'Food Store',
      date: 'Sunday, 24 January',
      amount: -15,
    ),
    ActivityItem(
      icon: Icons.local_cafe_outlined,
      title: 'Coffee House',
      date: 'Saturday, 23 January',
      amount: -8.5,
    ),
    ActivityItem(
      icon: Icons.payments_outlined,
      title: 'Salary',
      date: 'Friday, 22 January',
      amount: 4200,
    ),
  ];

  static const months = <MonthSpending>[
    MonthSpending('JAN', 700, 300),
    MonthSpending('FEB', 400, 300),
    MonthSpending('MAR', 1400, 700),
    MonthSpending('APR', 1500, 600),
    MonthSpending('MAY', 1900, 510),
    MonthSpending('JUN', 1700, 900),
  ];
}
