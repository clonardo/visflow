
"use strict";

var extObject = {

  initialize: function(para) {

    DataflowRangeFilter.base.initialize.call(this, para);

    this.inPorts = [
      DataflowPort.new(this, "inv1", "in-single"),
      DataflowPort.new(this, "inv2", "in-single"),
      DataflowPort.new(this, "in", "in-single")
    ];
    this.outPorts = [
      DataflowPort.new(this, "out", "out-multiple")
    ];
    this.prepare();
  },


  show: function() {

    DataflowRangeFilter.base.show.call(this); // call parent settings

    $("<div>on</div>")
      .prependTo(this.jqview);

    $("<div>[ <input id='v1' style='width:40%'/> , " +
    "<input id='v2' style='width:40%'/> ]</div>")
      .prependTo(this.jqview);

    this.jqview.find("input")
      .prop("disabled", true)
      .addClass("dataflow-input");
    this.v1 = -Infinity;
    this.v2 = +Infinity;
    this.jqv1 = this.jqview.find("#v1")
      .val(this.v1);
    this.jqv2 = this.jqview.find("#v2")
      .val(this.v2);
    //this.jqicon
      //.addClass("dataflow-range-icon");
  }

};

var DataflowRangeFilter = DataflowFilter.extend(extObject);
