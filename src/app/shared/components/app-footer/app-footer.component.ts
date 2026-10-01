import { Component, inject } from "@angular/core";
import { Router } from "@angular/router";

@Component({
  selector: "app-footer",
  templateUrl: "./app-footer.component.html",
  styleUrl: "./app-footer.component.scss",
})
export class AppFooterComponent {
  private router = inject(Router);

  /** Always takes the user to the top of Home, from anywhere — including when already there. */
  goHome(): void {
    if (this.router.url === "/" || this.router.url.startsWith("/home")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    this.router.navigateByUrl("/home").then(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  }
}
