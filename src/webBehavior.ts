/*
 *  Power BI Visualizations
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */

import powerbi from "powerbi-visuals-api";

// d3
import { Selection as d3Selection, select as d3Select } from "d3-selection";
type Selection<T1, T2 = T1> = d3Selection<any, T1, any, T2>;

import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import { FilterType, IIdentityFilterTarget, IIdentityFilter } from "powerbi-models";
import FilterAction = powerbi.FilterAction;
import IFilter = powerbi.IFilter;

import { ChicletSlicerSettingsModel } from "./chicletSlicerSettingsModel";
import { ChicletSlicerWithPageNavigation } from "./chicletSlicer";
import { ChicletSlicerDataPoint, PageNavigationSettings } from "./interfaces";

export interface ChicletSlicerBehaviorOptions {
    visualHost: IVisualHost;
    slicerItemContainers: Selection<any>;
    slicerItemLabels: Selection<any>;
    slicerItemInputs: Selection<any>;
    slicerClear: Selection<any>;
    dataPoints: ChicletSlicerDataPoint[];
    formattingSettings: ChicletSlicerSettingsModel;
    isHighContrastMode: boolean;
    jsonFilters: IFilter[] | undefined | any;
    pageNavigationSettings?: PageNavigationSettings;
    selectionManager: ISelectionManager;
}

export class ChicletSlicerWebBehavior {
    private slicers: Selection<any> | undefined;
    private slicerItemLabels: Selection<any> | undefined;
    private slicerItemInputs: Selection<any> | undefined;
    private formattingSettings: ChicletSlicerSettingsModel | undefined;
    private options: ChicletSlicerBehaviorOptions | undefined;
    private visualHost: IVisualHost | undefined;
    private selectionManager: ISelectionManager | undefined;
    private jsonFilters: IFilter[] | undefined | any;

    /**
     * Public for testability.
     */
    public dataPoints: ChicletSlicerDataPoint[] = [];

    public bindEvents(options: ChicletSlicerBehaviorOptions): void {
        const slicers: Selection<any> = this.slicers = options.slicerItemContainers,
            slicerClear: Selection<any> = options.slicerClear;

        this.slicerItemLabels = options.slicerItemLabels;
        this.slicerItemInputs = options.slicerItemInputs;
        this.dataPoints = options.dataPoints;

        this.formattingSettings = options.formattingSettings;
        this.options = options;
        this.visualHost = options.visualHost;
        this.selectionManager = options.selectionManager;
        this.jsonFilters = options.jsonFilters;

        slicers.on("mouseover", (event, dataPoint: ChicletSlicerDataPoint) => {
            if (dataPoint.selectable) {
                dataPoint.mouseOver = true;
                dataPoint.mouseOut = false;

                this.renderMouseover();
            }
        });

        slicers.on("mouseout", (event, dataPoint: ChicletSlicerDataPoint) => {
            if (dataPoint.selectable) {
                dataPoint.mouseOver = false;
                dataPoint.mouseOut = true;

                this.renderMouseover();
            }
        });

        slicers.on("click", (event: MouseEvent, dataPoint: ChicletSlicerDataPoint) => {
            if (!dataPoint.selectable) {
                return;
            }
            (<MouseEvent>event).preventDefault();

            // Check if page navigation is enabled
            const pageNavSettings = options.pageNavigationSettings;
            if (pageNavSettings && pageNavSettings.enablePageNavigation) {
                this.handlePageNavigation(dataPoint);
                return;
            }

            const index = dataPoint.id as number;

            const settings: ChicletSlicerSettingsModel = this.formattingSettings!;
            const multiselect: boolean = settings.generalCardSettings.multiselect.value;

            const selectedIndexes: number[] = this.dataPoints
                .filter((dataPoint: ChicletSlicerDataPoint) => dataPoint.selected && dataPoint.id !== undefined)
                .map(dataPoint => dataPoint.id as number); // id guarantees correct order in category array

            if (settings.generalCardSettings.forcedSelection.value && selectedIndexes.length === 1) {
                const availableDataPoints: ChicletSlicerDataPoint[] = this.dataPoints.filter((dataPoint: ChicletSlicerDataPoint) => {
                    return !dataPoint.filtered;
                });


                if (availableDataPoints[index]
                    && this.dataPoints[selectedIndexes[0]].identity === availableDataPoints[index].identity) {
                    return;
                }
            }

            // when holding alt
            // selects all chiclets between last selected datapoint and current selected datapoint
            // same as v1.6.3
            if (event.altKey && multiselect) {
                // selecting from last selected to current selected
                let startIndex: number = selectedIndexes.length > 0
                    ? (selectedIndexes[selectedIndexes.length - 1])
                    : 0;
                let endIndex = dataPoint.id as number;

                // reverse selection
                if (startIndex > endIndex) {
                    [endIndex, startIndex] = [startIndex, endIndex];
                }

                for (const dp of this.dataPoints) {
                    if (dp.id as number < startIndex || dp.id as number > endIndex) {
                        dp.selected = false;
                    }
                    else {
                        dp.selected = true;
                    }
                }

                this.renderSelection();
                this.saveSelection();

            }
            else {
                // can select multiple chiclets at once
                const multiselectEnabled = (<MouseEvent>event).ctrlKey || (<MouseEvent>event).metaKey || multiselect;
                this.handleSelection(dataPoint, multiselectEnabled);
            }
        });

        slicerClear.on("click", () => {
            const settings: ChicletSlicerSettingsModel = this.formattingSettings!;

            if (settings.generalCardSettings.forcedSelection.value) {
                return false;
            }

            this.handleClearSelection();
        });

        this.renderSelection();

        // force selection
        if (this.formattingSettings.generalCardSettings.forcedSelection.value) {
            this.forceSelection();
        }
    }

    // Method to handle page navigation
    private handlePageNavigation(dataPoint: ChicletSlicerDataPoint): void {
        if (!dataPoint || !this.visualHost) return;

        try {
            console.log(`Attempting navigation to: ${dataPoint.category}`);
            
            // Try window-based navigation
            if (window && window.location) {
                // Navigate within same report
                const currentUrl = window.location.href;
                const newUrl = currentUrl.replace(/#.*$/, `#${dataPoint.category}`);
                window.location.href = newUrl;
                console.log(`Navigation via window.location: ${newUrl}`);
            }
            
        } catch (e) {
            console.error("Navigation error:", e);
        }
    }

    private forceSelection(): void {
        // checks if there is a datapoint that is already selected, selects first suitable otherwise
        const selectedExists: boolean = this.dataPoints.some((dataPoint: ChicletSlicerDataPoint) => dataPoint.selected);
        if (!selectedExists) {
            const dataPoint = this.dataPoints.find((dataPoint: ChicletSlicerDataPoint) => dataPoint.selectable && !dataPoint.filtered);
            if (dataPoint) {
                dataPoint.selected = true;

                this.renderSelection();
                this.saveSelection();
            }
        }
    }

    private handleSelection(selecteDataPoint: ChicletSlicerDataPoint, multiSelect: boolean): void {
        this.dataPoints.forEach((dataPoint: ChicletSlicerDataPoint) => {
            if (selecteDataPoint.id === dataPoint.id) {
                dataPoint.selected = !dataPoint.selected;
            } else if (!multiSelect) {
                dataPoint.selected = false;
            }
        });

        this.renderSelection();
        this.saveSelection();
    }

    private handleClearSelection() {
        this.dataPoints.forEach((dataPoint: ChicletSlicerDataPoint) => {
            dataPoint.selected = false;
        });

        this.renderSelection();
        this.saveSelection();
    }

    private saveSelection(): void {
        const filterTargets: IIdentityFilterTarget = this.dataPoints
            .filter(d => d.selected && d.id !== undefined)
            .map(d => d.id as number); 


        // Selection manager stores selection ids in the order in which they are selected by the user.
        // This is needed because data should be sent to the host in the same order that the user selected.
        // If the order is not maintained, the host will show incorrect data in the visual.

        const target = (this.jsonFilters?.length && this.jsonFilters[0]?.target) ? this.jsonFilters[0].target : [];
        const sortedTargers = ChicletSlicerWebBehavior.sortByJSONFilterTarget(filterTargets, target);

        const filter: IIdentityFilter = {
            $schema: "https://powerbi.com/product/schema#identity",
            filterType: FilterType.Identity,
            operator: "In",
            target: sortedTargers
        }

        this.visualHost!.applyJsonFilter(filter, "general", "filter", FilterAction.merge);
    }

    public static sortByJSONFilterTarget(selected, jsonFilters: number[]): number[] {
        const reversed = jsonFilters.reverse();

        function compareIndexes(a: number, b: number) {
            return reversed.indexOf(b) - reversed.indexOf(a);
        }
        return selected.toSorted(compareIndexes);
    }

    private renderMouseover(): void {
        this.slicerItemLabels
            .style("color", (dataPoint: ChicletSlicerDataPoint) => {
                if (dataPoint.mouseOver) {
                    return this.formattingSettings.slicerTextCardSettings.hoverColor.value.value;
                }

                if (dataPoint.mouseOut) {
                    return this.formattingSettings.slicerTextCardSettings.fontColor.value.value;
                }
            })
            .style("opacity", (dataPoint: ChicletSlicerDataPoint) => {
                if (dataPoint.selectable) {
                    if (dataPoint.mouseOver) {
                        return this.options.isHighContrastMode ? ChicletSlicerWithPageNavigation.HoveredTextOpacity : ChicletSlicerWithPageNavigation.DefaultOpacity;
                    }
                }
                return ChicletSlicerWithPageNavigation.DefaultOpacity;
            });
    }

    private renderSelection() {
        const settings = this.formattingSettings,
            isHighContrastMode = this.options.isHighContrastMode;

        this.slicers.each(function (dataPoint: ChicletSlicerDataPoint) {
            d3Select(this)
                .style("background", dataPoint.selectable
                    ? (dataPoint.selected
                        ? settings.slicerTextCardSettings.selectedColor.value.value
                        : settings.slicerTextCardSettings.unselectedColor.value.value)
                    : settings.slicerTextCardSettings.disabledColor.value.value)
                .style("opacity", () => {
                    if (isHighContrastMode) {
                        return dataPoint.selectable ?
                            (dataPoint.selected ? ChicletSlicerWithPageNavigation.DefaultOpacity : ChicletSlicerWithPageNavigation.DimmedOpacity)
                            : ChicletSlicerWithPageNavigation.DisabledOpacity;
                    }
                    return ChicletSlicerWithPageNavigation.DefaultOpacity;
                })
                .classed("slicerItem-disabled", !dataPoint.selectable);
        });
    }
}
