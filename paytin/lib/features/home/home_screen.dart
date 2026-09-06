import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import 'widgets/balance_card.dart';
import 'widgets/home_header.dart';
import 'widgets/quick_actions.dart';
import 'widgets/quick_send.dart';
import 'widgets/recent_activity.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.scaffold,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 128),
          children: const [
            HomeHeader(),
            SizedBox(height: 18),
            BalanceCard(),
            SizedBox(height: 22),
            QuickActions(),
            SizedBox(height: 24),
            QuickSend(),
            SizedBox(height: 20),
            RecentActivity(),
          ],
        ),
      ),
    );
  }
}
