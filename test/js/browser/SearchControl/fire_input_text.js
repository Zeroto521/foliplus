const inp = document.querySelector("input");
inp.value = "some text";
inp.dispatchEvent(new Event("input"));
