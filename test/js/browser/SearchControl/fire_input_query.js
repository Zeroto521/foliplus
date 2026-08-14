const inp = document.querySelector("input");
inp.value = "test query";
inp.dispatchEvent(new Event("input"));
