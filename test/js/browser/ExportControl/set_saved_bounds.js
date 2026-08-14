key => {
  // Seed localStorage with saved geo bounds under the given storage key.
  localStorage.setItem(
    key,
    JSON.stringify({
      nw: { lat: 26.07, lng: 119.28 },
      se: { lat: 26.09, lng: 119.32 },
    }),
  );
};
