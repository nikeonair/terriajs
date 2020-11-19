import { action, computed, observable, runInAction } from "mobx";
import Constructor from "../Core/Constructor";
import isDefined from "../Core/isDefined";
import CommonStrata from "../Models/CommonStrata";
import createStratumInstance from "../Models/createStratumInstance";
import LoadableStratum from "../Models/LoadableStratum";
import Mappable, { MapItem } from "../Models/Mappable";
import Model, { BaseModel } from "../Models/Model";
import StratumOrder from "../Models/StratumOrder";
import CatalogFunctionJobTraits from "../Traits/CatalogFunctionJobTraits";
import { InfoSectionTraits } from "../Traits/CatalogMemberTraits";
import AutoRefreshingMixin from "./AutoRefreshingMixin";
import CatalogMemberMixin from "./CatalogMemberMixin";
import GroupMixin from "./GroupMixin";
import filterOutUndefined from "../Core/filterOutUndefined";
import TerriaError from "../Core/TerriaError";
import RequestErrorEvent from "terriajs-cesium/Source/Core/RequestErrorEvent";

class FunctionJobStratum extends LoadableStratum(CatalogFunctionJobTraits) {
  constructor(
    readonly catalogFunctionJob: CatalogFunctionJobMixin.CatalogFunctionJobMixin
  ) {
    super();
  }

  duplicateLoadableStratum(model: BaseModel): this {
    return new FunctionJobStratum(
      model as CatalogFunctionJobMixin.CatalogFunctionJobMixin
    ) as this;
  }

  @computed
  get shortReportSections() {
    if (this.catalogFunctionJob.logs.length === 0) return;
    return [
      {
        name: "Job Logs",
        content: this.catalogFunctionJob.logs.join("\n"),
        show: true
      }
    ];
  }

  @computed
  get shortReport() {
    let content = "";
    if (this.catalogFunctionJob.jobStatus === "inactive") {
      content = "Job is inactive";
    } else if (this.catalogFunctionJob.jobStatus === "running") {
      content = "Job is running...";
      // If job is running, but not polling - then warn user to not leave the page
      if (!this.catalogFunctionJob.refreshEnabled) {
        content +=
          "\n\nPlease do not leave this page &mdash; or results may be lost";
      }
    } else if (this.catalogFunctionJob.jobStatus === "finished") {
      if (this.catalogFunctionJob.downloadedResults) {
        content = "Job is finished";
      } else {
        content = "Job is finished, downloading results...";
      }
    } else {
      content = "An error has occurred";
    }
    return content;
  }

  @computed
  get description() {
    if (this.catalogFunctionJob.jobStatus === "finished")
      return `This is the result of invoking ${this.catalogFunctionJob.name} with the input parameters below.`;
  }

  @computed
  get info() {
    if (
      isDefined(this.catalogFunctionJob.parameters) &&
      Object.values(this.catalogFunctionJob.parameters).length > 0
    ) {
      const inputsSection =
        '<table class="cesium-infoBox-defaultTable">' +
        Object.keys(this.catalogFunctionJob.parameters).reduce(
          (previousValue, key) => {
            return (
              previousValue +
              "<tr>" +
              '<td style="vertical-align: middle">' +
              key +
              "</td>" +
              "<td>" +
              this.catalogFunctionJob.parameters![key] +
              "</td>" +
              "</tr>"
            );
          },
          ""
        ) +
        "</table>";

      return [
        createStratumInstance(InfoSectionTraits, {
          name: "Inputs",
          content: inputsSection
        })
      ];
    }
  }
}

type CatalogFunctionJobMixin = Model<CatalogFunctionJobTraits>;

function CatalogFunctionJobMixin<
  T extends Constructor<CatalogFunctionJobMixin>
>(Base: T) {
  abstract class CatalogFunctionJobMixin extends GroupMixin(
    AutoRefreshingMixin(CatalogMemberMixin(Base))
  ) {
    constructor(...args: any[]) {
      super(...args);

      // Add FunctionJobStratum to strata
      runInAction(() => {
        this.strata.set(FunctionJobStratum.name, new FunctionJobStratum(this));
      });
    }

    /**
     *
     * @returns true for FINISHED, false for RUNNING (will then call pollForResults)
     */
    protected abstract async _invoke(): Promise<boolean>;

    @action
    public async invoke() {
      this.setTrait(CommonStrata.user, "jobStatus", "running");
      try {
        const finished = await this._invoke();
        if (finished) {
          this.setTrait(CommonStrata.user, "jobStatus", "finished");
          this.onJobFinish(true);
        } else {
          this.setTrait(CommonStrata.user, "refreshEnabled", true);
        }
      } catch (error) {
        this.setTrait(CommonStrata.user, "jobStatus", "error");
        this.setOnError(error);
        throw error; // throw error to CatalogFunctionMixin
      }
    }

    get refreshInterval() {
      return 2;
    }

    private pollingForResults = false;

    /**
     * Called every refreshInterval
     *
     * @return true if job has finished, false otherwise
     */
    async pollForResults(): Promise<boolean> {
      throw "pollForResults not implemented";
    }

    /**
     * This function adapts AutoRefreshMixin's refreshData with this Mixin's pollForResults - adding the boolean return value which triggers refresh disable
     */
    @action
    refreshData() {
      if (this.pollingForResults) {
        return;
      }

      this.pollingForResults = true;

      this.pollForResults()
        .then(finished => {
          if (finished) {
            runInAction(() => {
              this.setTrait(CommonStrata.user, "jobStatus", "finished");
              this.setTrait(CommonStrata.user, "refreshEnabled", false);
            });
            this.onJobFinish(true);
          }
          this.pollingForResults = false;
        })
        .catch(error => {
          runInAction(() => {
            this.setTrait(CommonStrata.user, "jobStatus", "error");
            this.setTrait(CommonStrata.user, "refreshEnabled", false);
            this.setOnError(error);
          });
          this.pollingForResults = false;
        });
    }

    private downloadingResults = false;

    /**
     * This handles downloading job results, it can be triggered three ways:
     * - `_invoke` returns true {@link CatalogFunctionJobMixin#invoke}
     * - `pollForResults` returns true {@link CatalogFunctionJobMixin#refreshData}
     * - on `loadMetadata` if `jobStatus` is "finished", and `!downloadedResults`  {@link CatalogFunctionJobMixin#forceLoadMetadata}
     */
    @action
    private async onJobFinish(addResultsToWorkbench = this.inWorkbench) {
      // Download results when finished
      if (
        this.jobStatus === "finished" &&
        !this.downloadedResults &&
        !this.downloadingResults
      ) {
        this.downloadingResults = true;
        this.results = (await this.downloadResults()) || [];
        this.results.forEach(result => {
          if (Mappable.is(result))
            result.setTrait(CommonStrata.user, "show", true);
          if (addResultsToWorkbench) this.terria.workbench.add(result);

          this.terria.addModel(result);
        });

        runInAction(() => {
          this.setTrait(
            CommonStrata.user,
            "members",
            filterOutUndefined(this.results.map(result => result.uniqueId))
          );
          this.setTrait(CommonStrata.user, "downloadedResults", true);
        });
        this.downloadingResults = false;
      }
    }

    /**
     * Job result CatalogMembers - set from calling {@link CatalogFunctionJobMixin#downloadResults}
     */
    @observable
    public results: CatalogMemberMixin.CatalogMemberMixin[] = [];

    /**
     * Called in {@link CatalogFunctionJobMixin#onJobFinish}
     * @returns catalog members to add to workbench
     */
    abstract async downloadResults(): Promise<
      CatalogMemberMixin.CatalogMemberMixin[] | void
    >;

    @action
    protected setOnError(error?: any) {
      let errorMessage: string | undefined;
      if (error instanceof TerriaError) {
        errorMessage = error.message;
      }

      if (typeof error !== "string") {
        if (
          error instanceof RequestErrorEvent &&
          typeof error.response?.detail === "string"
        )
          errorMessage = error.response.detail;
      }

      isDefined(errorMessage) &&
        this.setTrait(CommonStrata.user, "logs", [...this.logs, errorMessage]);

      this.setTrait(
        CommonStrata.user,
        "shortReport",
        `${this.typeName ||
          this
            .type} invocation failed. More details are available on the Info panel.`
      );

      const errorInfo = createStratumInstance(InfoSectionTraits, {
        name: `${this.typeName || this.type} invocation failed.`,
        content: errorMessage ?? "The reason for failure is unknown."
      });

      const info = this.getTrait(CommonStrata.user, "info");
      if (isDefined(info)) {
        info.push(errorInfo);
      } else {
        this.setTrait(CommonStrata.user, "info", [errorInfo]);
      }
    }

    @computed
    get mapItems(): MapItem[] {
      return [];
    }
    protected async forceLoadMapItems() {}

    @action
    protected async forceLoadMetadata() {
      if (this.jobStatus === "finished" && !this.downloadedResults) {
        await this.onJobFinish();
      }
    }

    protected async forceLoadMembers() {}

    get hasCatalogFunctionJobMixin() {
      return true;
    }
  }

  return CatalogFunctionJobMixin;
}

namespace CatalogFunctionJobMixin {
  StratumOrder.addLoadStratum(FunctionJobStratum.name);
  export interface CatalogFunctionJobMixin
    extends InstanceType<ReturnType<typeof CatalogFunctionJobMixin>> {}
  export function isMixedInto(model: any): model is CatalogFunctionJobMixin {
    return model && model.hasCatalogFunctionJobMixin;
  }
}

export default CatalogFunctionJobMixin;
