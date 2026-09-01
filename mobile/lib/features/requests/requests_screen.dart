import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/format.dart';
import '../../data/api.dart';
import '../../data/models/records.dart';
import '../../data/repos.dart';
import '../../data/session.dart';
import '../../widgets/common.dart';

/// Staff requests — leave, early departure, an advance on salary.
///
/// Someone with `requests.approve` sees everything and can decide here; anyone
/// else sees only their own, which is the useful half on a phone anyway.
class RequestsScreen extends StatelessWidget {
  const RequestsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final approver = Session.instance.can('requests.approve');

    return LumaPage(
      title: 'الطلبات',
      subtitle: approver ? 'طلبات الفريق' : 'طلباتك',
      onBack: () => Navigator.of(context).pop(),
      child: StreamList<StaffRequest>(
        stream: Repos.instance.requests(
          employeeId: approver ? null : Session.instance.uid,
        ),
        empty: const EmptyState(
          icon: Icons.inbox_rounded,
          title: 'لا توجد طلبات',
        ),
        itemBuilder: (context, request) =>
            _RequestCard(request: request, canDecide: approver),
      ),
    );
  }
}

class _RequestCard extends StatefulWidget {
  const _RequestCard({required this.request, required this.canDecide});

  final StaffRequest request;
  final bool canDecide;

  @override
  State<_RequestCard> createState() => _RequestCardState();
}

class _RequestCardState extends State<_RequestCard> {
  bool _busy = false;

  Future<void> _decide(bool approve) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);

    try {
      // Through the callable, never a direct write: approving is a privileged
      // act and the server re-checks who is asking.
      await LumaApi.instance.call('decideRequest', payload: {
        'requestId': widget.request.id,
        'status': approve ? 'approved' : 'rejected',
      });
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          content: Text(approve ? 'تمت الموافقة على الطلب.' : 'تم رفض الطلب.'),
        ));
    } on ApiException catch (error) {
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final request = widget.request;
    final showActions = widget.canDecide && request.isPending;

    return TapCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: request.statusColor.withValues(alpha: .14),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(request.typeIcon,
                    color: request.statusColor, size: 21),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      request.typeLabel,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    _Meta(request: request, showWho: widget.canDecide),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Pill(label: request.statusLabel, color: request.statusColor),
            ],
          ),
          if (request.reason.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              request.reason,
              style: TextStyle(
                fontSize: 13.5,
                color: AppColors.textSecondary,
                height: 1.6,
              ),
            ),
          ],
          if (showActions) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _Action(
                    label: 'موافقة',
                    icon: Icons.check_rounded,
                    color: AppColors.success,
                    busy: _busy,
                    onTap: () => _decide(true),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _Action(
                    label: 'رفض',
                    icon: Icons.close_rounded,
                    color: AppColors.danger,
                    busy: _busy,
                    onTap: () => _decide(false),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.request, required this.showWho});

  final StaffRequest request;
  final bool showWho;

  @override
  Widget build(BuildContext context) {
    final bits = <String>[
      if (request.requestNo.isNotEmpty) '#${request.requestNo}',
      if (request.days != null) '${request.days} يوم',
      if (request.amount != null) '${request.amount} د.أ',
      if (request.fromDate != null) Fmt.date(request.fromDate!),
    ];

    final line = Text(
      bits.join('  ·  '),
      style: TextStyle(fontSize: 12, color: AppColors.textMuted),
    );

    if (!showWho || request.employeeId.isEmpty) return line;

    return FutureBuilder(
      future: Repos.instance.person(request.employeeId),
      builder: (context, snapshot) {
        final name = snapshot.data?.name;
        return Text(
          [?name, ...bits].join('  ·  '),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
        );
      },
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({
    required this.label,
    required this.icon,
    required this.color,
    required this.busy,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final Color color;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: busy ? null : onTap,
      child: Container(
        height: 42,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: color.withValues(alpha: busy ? .06 : .14),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 17, color: busy ? AppColors.textMuted : color),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: busy ? AppColors.textMuted : color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
