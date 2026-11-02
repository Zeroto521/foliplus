window.h3 = {
  latLngToCell: function () {
    return "";
  },
  cellToBoundary: function (c) {
    return [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
  },
  cellToLatLng: function () {
    return [0, 0];
  },
};
window.ss = {
  jenks: function () {
    return [0, 1];
  },
  quantile: function () {
    return 0.5;
  },
};
window.chroma = {
  scale: function () {
    return {
      mode: function () {
        return {
          colors: function () {
            return ["#f00"];
          },
        };
      },
    };
  },
};
