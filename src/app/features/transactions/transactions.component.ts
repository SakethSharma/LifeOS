import {
  Component,
  inject,
  computed,
  signal,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TransactionService } from "../../core/services/transaction.service";
import { SettingsService } from "../../core/services/settings.service";
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
import { CurrencyFormatPipe } from "../../shared/pipes/currency-format.pipe";
import { DateFormatPipe } from "../../shared/pipes/date-format.pipe";

@Component({
  selector: "app-transactions",
  templateUrl: "./transactions.component.html",
  styleUrl: "./transactions.component.scss",
  imports: [
    FormsModule,
    EmptyStateComponent,
    PageHeaderComponent,
    ConfirmDialogComponent,
    CurrencyFormatPipe,
    DateFormatPipe,
  ],
})
export class TransactionsComponent implements OnInit, OnDestroy {
  private transactionService = inject(TransactionService);
  private settingsService = inject(SettingsService);

  transactions = this.transactionService.transactions;
  symbol = this.settingsService.currencySymbol;

  dateFormat = computed(
    () => this.settingsService.settings()?.dateFormat ?? "MMM d, yyyy",
  );

  searchTerm = signal("");
  typeFilter = signal("");
  categoryFilter = signal("");
  sortBy = signal("date-desc");

  showForm = signal(false);
  editingId = signal<string | null>(null);
  showDeleteConfirm = signal(false);
  deletingTx: Transaction | null = null;

  paymentMethods = PAYMENT_METHODS;

  formData: NewTransaction = {
    type: "expense",
    amount: 0,
    category: "",
    date: new Date().toISOString().slice(0, 10),
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

  currentCategories = computed(() => {
    return this.formData.type === "income"
      ? [...INCOME_CATEGORIES]
      : [...EXPENSE_CATEGORIES];
  });

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
          return a.date.localeCompare(b.date);

        case "date-desc":
          return b.date.localeCompare(a.date);

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

  hasFilters = computed(() => {
    return !!(this.searchTerm() || this.typeFilter() || this.categoryFilter());
  });

  ngOnInit(): void {}

  ngOnDestroy(): void {}

  clearFilters(): void {
    this.searchTerm.set("");
    this.typeFilter.set("");
    this.categoryFilter.set("");
  }

  openAddForm(): void {
    this.editingId.set(null);

    this.formData = {
      type: "expense",
      amount: 0,
      category: "",
      date: new Date().toISOString().slice(0, 10),
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
    if (!this.validate()) {
      return;
    }

    const data: NewTransaction = {
      type: this.formData.type as TransactionType,
      amount: Number(this.formData.amount),
      category: this.formData.category,
      date: this.formData.date,
      description: this.formData.description.trim(),
      paymentMethod: this.formData.paymentMethod || undefined,
      notes: this.formData.notes || undefined,
    };

    const editingId = this.editingId();

    if (editingId) {
      await this.transactionService.update(editingId, data);
    } else {
      await this.transactionService.add(data);
    }

    this.closeForm();
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
