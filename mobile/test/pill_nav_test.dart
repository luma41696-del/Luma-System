import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:luma/widgets/pill_nav.dart';

void main() {
  Widget host({required Widget bar}) => MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            extendBody: true,
            body: const SizedBox.expand(),
            bottomNavigationBar: bar,
          ),
        ),
      );

  const items = [
    NavItem(icon: Icons.home_rounded, label: 'الرئيسية'),
    NavItem(icon: Icons.checklist_rounded, label: 'المهام'),
    NavItem(icon: Icons.notifications_rounded, label: 'الإشعارات'),
    NavItem(icon: Icons.grid_view_rounded, label: 'المزيد'),
  ];

  testWidgets('the bar hugs the pill instead of filling the screen', (tester) async {
    // The first build used a Center here. A Scaffold hands its bottom bar loose
    // constraints as tall as the screen, so Center expanded to fill them and the
    // pill was drawn across the middle of the content.
    await tester.pumpWidget(host(
      bar: PillNav(
        items: items,
        index: 0,
        onSelect: (_) {},
        onCentre: () {},
        centreIcon: Icons.bolt_rounded,
        centreLabel: 'اليوم',
      ),
    ));

    final screen = tester.getSize(find.byType(Scaffold)).height;
    final bar = tester.getSize(find.byType(PillNav)).height;

    expect(bar, lessThan(120));
    expect(bar, lessThan(screen / 3));
  });

  testWidgets('the pill sits at the bottom of the screen', (tester) async {
    await tester.pumpWidget(host(
      bar: PillNav(
        items: items,
        index: 0,
        onSelect: (_) {},
        onCentre: () {},
        centreIcon: Icons.bolt_rounded,
        centreLabel: 'اليوم',
      ),
    ));

    final screen = tester.getSize(find.byType(Scaffold)).height;
    final pill = tester.getRect(find.byType(PillNav));

    // Its bottom edge is the screen's bottom edge, not somewhere in the middle.
    expect(pill.bottom, closeTo(screen, 1));
    expect(pill.top, greaterThan(screen * 0.8));
  });

  testWidgets('tapping reports the index that was tapped', (tester) async {
    final tapped = <int>[];
    var centre = 0;

    await tester.pumpWidget(host(
      bar: PillNav(
        items: items,
        index: 0,
        onSelect: tapped.add,
        onCentre: () => centre++,
        centreIcon: Icons.bolt_rounded,
        centreLabel: 'اليوم',
      ),
    ));

    // The centre button sits between items 1 and 2, so the indices must not
    // shift around it.
    await tester.tap(find.byIcon(Icons.notifications_rounded));
    await tester.tap(find.byIcon(Icons.grid_view_rounded));
    await tester.tap(find.byIcon(Icons.bolt_rounded));

    expect(tapped, [2, 3]);
    expect(centre, 1);
  });
}
