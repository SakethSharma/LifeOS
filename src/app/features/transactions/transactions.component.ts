import {
  Component,
  inject,
  computed,
  effect,
  signal,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TransactionService } from "../../core/services/transaction.service";
import { SettingsService } from "../../core/services/settings.service";
import { BackButtonService } from "../../core/services/back-button.service";
import {
  Transaction,
  TransactionType,
  NewTransaction,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
} from "../../core/models/transaction.model";
import { EmptyStateComponent } from "../../shared/components/empty-state/empty-state.component";
import { PageHeaderComponent } from "../../shared/components/page-header/page-header.component";
import { ConfirmDialogComponent } from "../../shared/components/confirm-dialog/confirm-dialog.component";
import {
  SelectComponent,
  SelectOption,
} from "../../shared/components/select/select.component";
import { DateFieldComponent } from "../../shared/components/date-field/date-field.component";
import { TimeFieldComponent } from "../../shared/components/time-field/time-field.component";
import { CurrencyFormatPipe } from "../../shared/pipes/currency-format.pipe";
import { DateFormatPipe } from "../../shared/pipes/date-format.pipe";
import {
  currentTimeString,
  formatTime12,
  toDateString,
} from "../../core/utilities/format.util";

@Component({
  selector: "app-transactions",
  templateUrl: "./transactions.component.html",
  styleUrl: "./transactions.component.scss",
  imports: [
    FormsModule,
    EmptyStateComponent,
    PageHeaderComponent,
    ConfirmDialogComponent,
    SelectComponent,
    DateFieldComponent,
    TimeFieldComponent,
    CurrencyFormatPipe,
    DateFormatPipe,
  ],
})
export class TransactionsComponent implements OnInit, OnDestroy {
  private transactionService = inject(TransactionService);
  private settingsService = inject(SettingsService);
  private backButton = inject(BackButtonService);

  constructor() {
    // While the add/edit dialog is open, Android Back closes it first.
    effect((onCleanup) => {
      if (this.showForm()) {
        onCleanup(this.backButton.register(() => this.closeForm()));
      }
    });
  }

  transactions = this.transactionService.transactions;
  symbol = this.settingsService.currencySymbol;

  searchTerm = signal("");
  typeFilter = signal("");
  categoryFilter = signal("");
  sortBy = signal("date-desc");
  showAdvanced = signal(false);

  showForm = signal(false);
  saving = signal(false);
  editingId = signal<string | null>(null);
  showDeleteConfirm = signal(false);
  deletingTx: Transaction | null = null;

  paymentMethods = PAYMENT_METHODS;

  // Dropdown options (filters + form).
  typeOptions: SelectOption[] = [
    { value: "", label: "All Types" },
    { value: "income", label: "Income" },
    { value: "expense", label: "Expense" },
  ];

  sortOptions: SelectOption[] = [
    { value: "date-desc", label: "Date (Newest)" },
    { value: "date-asc", label: "Date (Oldest)" },
    { value: "amount-desc", label: "Amount (High to Low)" },
    { value: "amount-asc", label: "Amount (Low to High)" },
  ];

  paymentOptions: SelectOption[] = [
    { value: "", label: "None" },
    ...PAYMENT_METHODS.map((pm) => ({ value: pm, label: pm })),
  ];

  formData: NewTransaction = {
    type: "expense",
    amount: 0,
    category: "",
    date: toDateString(new Date()),
    time: currentTimeString(),
    description: "",
    paymentMethod: "",
    notes: "",
  };

  formErrors = signal<Record<string, string>>({});

  allCategories = computed(() => {
    const cats = new Set<string>();

    this.transactions().forEach((t) => cats.add(t.category));

    return Array.from(cats).sort();
  });

  categoryFilterOptions = computed<SelectOption[]>(() => [
    { value: "", label: "All Categories" },
    ...this.allCategories().map((c) => ({ value: c, label: c })),
  ]);

  currentCategories = computed(() => {
    return this.formData.type === "income"
      ? [...INCOME_CATEGORIES]
      : [...EXPENSE_CATEGORIES];
  });

  private readonly expenseCategoryOptions: SelectOption[] =
    EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }));

  private readonly incomeCategoryOptions: SelectOption[] =
    INCOME_CATEGORIES.map((c) => ({ value: c, label: c }));

  // formData is a plain object (not a signal); returning one of two stable
  // arrays keeps the [options] binding from changing on every check.
  get categoryOptions(): SelectOption[] {
    return this.formData.type === "income"
      ? this.incomeCategoryOptions
      : this.expenseCategoryOptions;
  }

  filteredTransactions = computed(() => {
    let result = this.transactions();

    const search = this.searchTerm().toLowerCase().trim();

    if (search) {
      result = result.filter(
        (t) =>
          t.description.toLowerCase().includes(search) ||
          t.category.toLowerCase().includes(search) ||
          (t.notes ?? "").toLowerCase().includes(search),
      );
    }

    const typeF = this.typeFilter();

    if (typeF) {
      result = result.filter((t) => t.type === typeF);
    }

    const catF = this.categoryFilter();

    if (catF) {
      result = result.filter((t) => t.category === catF);
    }

    const sort = this.sortBy();

    result = [...result].sort((a, b) => {
      switch (sort) {
        case "date-asc":
          return (
            a.date.localeCompare(b.date) ||
            (a.time ?? "").localeCompare(b.time ?? "")
          );

        case "date-desc":
          return (
            b.date.localeCompare(a.date) ||
            (b.time ?? "").localeCompare(a.time ?? "")
          );

        case "amount-asc":
          return a.amount - b.amount;

        case "amount-desc":
          return b.amount - a.amount;

        default:
          return b.date.localeCompare(a.date);
      }
    });

    return result;
  });

  // Filters hidden behind "Advanced search" still apply; this drives the badge.
  activeFilterCount = computed(
    () =>
      (this.typeFilter() ? 1 : 0) +
      (this.categoryFilter() ? 1 : 0) +
      (this.sortBy() !== "date-desc" ? 1 : 0),
  );

  ngOnInit(): void {}

  ngOnDestroy(): void {}

  resetAdvanced(): void {
    this.typeFilter.set("");
    this.categoryFilter.set("");
    this.sortBy.set("date-desc");
  }

  openAddForm(): void {
    this.editingId.set(null);

    this.formData = {
      type: "expense",
      amount: 0,
      category: "",
      date: toDateString(new Date()),
      time: currentTimeString(),
      description: "",
      paymentMethod: "",
      notes: "",
    };

    this.formErrors.set({});
    this.showForm.set(true);
  }

  openEditForm(tx: Transaction): void {
    this.editingId.set(tx.id);

    this.formData = {
      type: tx.type,
      amount: tx.amount,
      category: tx.category,
      date: tx.date,
      // Older records have no time; leave it empty rather than inventing one.
      time: tx.time ?? "",
      description: tx.description,
      paymentMethod: tx.paymentMethod ?? "",
      notes: tx.notes ?? "",
    };

    this.formErrors.set({});
    this.showForm.set(true);
  }

  closeForm(): void {
    this.showForm.set(false);
    this.editingId.set(null);
  }

  setType(type: TransactionType): void {
    this.formData.type = type;

    // Keep the chosen category only if it exists for the new type.
    if (!this.categoryOptions.some((o) => o.value === this.formData.category)) {
      this.formData.category = "";
    }
  }

  time12(time: string | undefined): string {
    return formatTime12(time);
  }

  validate(): boolean {
    const errors: Record<string, string> = {};

    if (!this.formData.amount || this.formData.amount <= 0) {
      errors["amount"] = "Amount must be greater than 0";
    }

    if (!this.formData.date) {
      errors["date"] = "Date is required";
    }

    if (!this.formData.category) {
      errors["category"] = "Category is required";
    }

    if (!this.formData.description || !this.formData.description.trim()) {
      errors["description"] = "Description is required";
    }

    this.formErrors.set(errors);

    return Object.keys(errors).length === 0;
  }

  async saveForm(): Promise<void> {
    if (this.saving() || !this.validate()) {
      return;
    }

    const data: NewTransaction = {
      type: this.formData.type as TransactionType,
      amount: Number(this.formData.amount),
      category: this.formData.category,
      date: this.formData.date,
      time: this.formData.time || undefined,
      description: this.formData.description.trim(),
      paymentMethod: this.formData.paymentMethod || undefined,
      notes: this.formData.notes || undefined,
    };

    const editingId = this.editingId();

    this.saving.set(true);

    try {
      if (editingId) {
        await this.transactionService.update(editingId, data);
      } else {
        await this.transactionService.add(data);
      }

      this.closeForm();
    } finally {
      this.saving.set(false);
    }
  }

  confirmDelete(tx: Transaction): void {
    this.deletingTx = tx;
    this.showDeleteConfirm.set(true);
  }

  async deleteTransaction(): Promise<void> {
    if (this.deletingTx) {
      await this.transactionService.delete(this.deletingTx.id);
      this.deletingTx = null;
    }

    this.showDeleteConfirm.set(false);
  }
}
