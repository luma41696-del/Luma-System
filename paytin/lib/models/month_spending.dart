class MonthSpending {
  const MonthSpending(this.label, this.debit, this.credit);

  final String label;
  final double debit;
  final double credit;

  double get total => debit + credit;
}
