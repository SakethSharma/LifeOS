import { Component, inject } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { TransactionService } from "../../core/services/transaction.service";
import { DemoDataService } from "../../core/services/demo-data.service";

@Component({
  selector: "app-home",
  standalone: true,
  templateUrl: "./home.component.html",
  styleUrl: "./home.component.scss",
  imports: [RouterLink],
})
export class HomeComponent {
  private router = inject(Router);
  private transactionService = inject(TransactionService);
  private demoData = inject(DemoDataService);

  private exploring = false;

  async exploreDemo(): Promise<void> {
    if (this.exploring) return;
    this.exploring = true;

    try {
      // Demo data is loaded once; if it is already present, just open the dashboard.
      if (!this.transactionService.hasDemoData()) {
        const demoTransactions = this.demoData.generate(120);
        await this.transactionService.bulkAdd(demoTransactions);
      }

      this.router.navigate(["/dashboard"]);
    } finally {
      this.exploring = false;
    }
  }
}
