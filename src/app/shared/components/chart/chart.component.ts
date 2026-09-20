import {
  Component,
  Input,
  OnInit,
  OnChanges,
  OnDestroy,
  ViewChild,
  ElementRef,
  SimpleChanges,
} from "@angular/core";
import * as echarts from "echarts";

export type ChartType = "bar" | "line" | "pie" | "donut" | "horizontalBar";

export interface ChartSeries {
  name: string;
  data: number[];
}

@Component({
  selector: "app-chart",
  templateUrl: "./chart.component.html",
  styleUrl: "./chart.component.scss",
})
export class ChartComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild("chartContainer", { static: true })
  container!: ElementRef<HTMLDivElement>;

  @Input() type: ChartType = "bar";
  @Input() labels: string[] = [];
  @Input() series: ChartSeries[] = [];
  @Input() height: number = 300;
  @Input() colors: string[] = [];
  @Input() showLegend = true;
  @Input() showTooltip = true;
  @Input() horizontal = false;
  @Input() stacked = false;
  @Input() smooth = false;
  @Input() areaStyle = false;

  private chart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  ngOnInit(): void {
    this.chart = echarts.init(this.container.nativeElement, undefined, {
      renderer: "canvas",
    });

    this.renderChart();

    this.resizeObserver = new ResizeObserver(() => {
      this.chart?.resize();
    });

    this.resizeObserver.observe(this.container.nativeElement);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      this.chart &&
      (changes["labels"] || changes["series"] || changes["type"])
    ) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
    this.chart = null;
  }

  private renderChart(): void {
    if (!this.chart) {
      return;
    }

    const isDark =
      document.documentElement.getAttribute("data-theme") === "dark";

    const textColor = isDark ? "#a0a0b0" : "#666";
    const axisColor = isDark ? "#333344" : "#e0e0e0";

    const defaultColors = [
      "#3b82f6",
      "#10b981",
      "#f59e0b",
      "#ef4444",
      "#8b5cf6",
      "#ec4899",
      "#06b6d4",
      "#84cc16",
    ];

    const colorList = this.colors.length > 0 ? this.colors : defaultColors;

    let option: echarts.EChartsOption = {};

    if (this.type === "pie" || this.type === "donut") {
      const pieData = this.labels.map((label, i) => ({
        name: label,
        value: this.series[0]?.data[i] ?? 0,
      }));

      option = {
        tooltip: {
          trigger: "item",
          show: this.showTooltip,
          formatter: "{b}: {c} ({d}%)",
        },

        legend: {
          show: this.showLegend,
          bottom: 0,
          textStyle: {
            color: textColor,
            fontSize: 11,
          },
          type: "scroll",
        },

        color: colorList,

        series: [
          {
            type: "pie",
            radius: this.type === "donut" ? ["40%", "70%"] : "70%",
            center: ["50%", "45%"],
            data: pieData,

            label: {
              show: this.type !== "donut",
              color: textColor,
              fontSize: 11,
            },

            labelLine: {
              show: this.type !== "donut",
            },

            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: "rgba(0, 0, 0, 0.3)",
              },
            },
          },
        ],
      };
    } else {
      const isHorizontal = this.horizontal;
      const categoryAxis = isHorizontal ? "yAxis" : "xAxis";
      const valueAxis = isHorizontal ? "xAxis" : "yAxis";

      const seriesData = this.series.map((s, i) => {
        if (this.type === "line") {
          return {
            name: s.name,
            type: "line",
            data: s.data,
            smooth: this.smooth,
            areaStyle: this.areaStyle ? { opacity: 0.15 } : undefined,

            itemStyle: {
              color: colorList[i % colorList.length],
            },

            lineStyle: {
              width: 2,
            },
          };
        }

        return {
          name: s.name,
          type: "bar",
          data: s.data,
          stack: this.stacked ? "total" : undefined,

          itemStyle: {
            color: colorList[i % colorList.length],
            borderRadius: [4, 4, 0, 0],
          },

          barMaxWidth: 40,
        };
      });

      option = {
        tooltip: {
          trigger: "axis",
          show: this.showTooltip,
          axisPointer: {
            type: "shadow",
          },
        },

        legend: {
          show: this.showLegend && this.series.length > 1,
          bottom: 0,
          textStyle: {
            color: textColor,
            fontSize: 11,
          },
        },

        grid: {
          left: isHorizontal ? "3%" : "3%",
          right: "4%",
          bottom: this.showLegend && this.series.length > 1 ? "15%" : "8%",
          top: "5%",
          containLabel: true,
        },

        [categoryAxis]: {
          type: "category",
          data: this.labels,

          axisLabel: {
            color: textColor,
            fontSize: 11,
            rotate: isHorizontal ? 0 : 0,
          },

          axisLine: {
            lineStyle: {
              color: axisColor,
            },
          },

          axisTick: {
            show: false,
          },
        },

        [valueAxis]: {
          type: "value",

          axisLabel: {
            color: textColor,
            fontSize: 11,
          },

          axisLine: {
            show: false,
          },

          splitLine: {
            lineStyle: {
              color: axisColor,
            },
          },
        },

        color: colorList,
        series: seriesData as any,
      };
    }

    this.chart.setOption(option, true);
  }
}
